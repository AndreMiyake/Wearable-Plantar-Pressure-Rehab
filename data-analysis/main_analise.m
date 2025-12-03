% Processamento em lote dos CSVs exportados para gerar matrizes e graficos.
% Compatibilizado com Octave 10 (sem suporte a readtable/table/exportgraphics).

clear; clc;

% Carrega funcoes de controle, caso ainda nao estejam no caminho.
if ~exist('tf', 'file')
    try
        pkg load control;
    catch
        error('Pacote "control" nao encontrado. Instale com: pkg install -forge control');
    end
end

% Carrega funcoes de processamento de sinais (findpeaks), se necessario.
if ~exist('findpeaks', 'file')
    try
        pkg load signal;
    catch
        error('Pacote "signal" nao encontrado. Instale com: pkg install -forge signal');
    end
end

baseDir = fileparts(mfilename('fullpath'));
inputDir = fullfile(baseDir, 'input');
outputDir = fullfile(baseDir, 'output');
if ~exist(outputDir, 'dir')
    mkdir(outputDir);
end

files = dir(fullfile(inputDir, '*.csv'));
if isempty(files)
    disp('Nenhum CSV encontrado em ./input.');
    return;
end

resumo = [];
zeta = 0.7;
wn = 6; % rad/s, levemente subamortecido para suavizacao

for k = 1:numel(files)
    filePath = fullfile(files(k).folder, files(k).name);
    csvData = read_csv_matrix(filePath);
    if size(csvData.matrix, 1) < 2
        fprintf('Arquivo %s possui dados insuficientes.\n', files(k).name);
        continue;
    end

    headers = csvData.headers;
    tsIdx = find(strcmpi(headers, 'timestamp'), 1);
    if isempty(tsIdx)
        error('Coluna "timestamp" nao encontrada em %s', files(k).name);
    end
    t = csvData.matrix(:, tsIdx);
    t = t(:);
    dtRaw = diff(t);
    Ts = median(dtRaw);
    % Normaliza timestamps vindos em ms (ex.: Arduino) para segundos reais.
    % Critérios conservadores: passo médio > 5 s OU amplitude total > 1000 (ms típicos).
    if Ts > 5 || max(t) > 1e3
        t = t / 1000;
        dtRaw = dtRaw / 1000;
        Ts = median(dtRaw);
    end
    Fs = 1 / Ts;

    wanted = {'fsr1','fsr2','fsr3','fsr4'};
    fsrCols = find(ismember(lower(headers), wanted));
    if isempty(fsrCols)
        error('Nenhuma das colunas fsr1..fsr4 encontrada em %s', files(k).name);
    end
    rawSignals = csvData.matrix(:, fsrCols);
    totalRaw = sum(rawSignals, 2);

    num = wn^2;
    den = [1, 2*zeta*wn, wn^2];
    sysc = tf(num, den);
    sysd = c2d(sysc, Ts, 'tustin');

    filteredSignals = zeros(size(rawSignals));
    for c = 1:size(rawSignals, 2)
        filteredSignals(:, c) = lsim(sysd, rawSignals(:, c), t);
    end
    totalFiltered = sum(filteredSignals, 2);

    impulso = 0;
    taxaCargaMax = -inf;
    for i = 2:length(t)
        dt = t(i) - t(i-1);
        impulso = impulso + 0.5 * dt * (totalFiltered(i) + totalFiltered(i-1));
        deriv = (totalFiltered(i) - totalFiltered(i-1)) / dt;
        if deriv > taxaCargaMax
            taxaCargaMax = deriv;
        end
    end

    % Seleciona trecho ativo (descarta longos períodos sem contato)
    thresh = 0.05 * max(totalFiltered);
    activeMask = totalFiltered > thresh;
    if any(activeMask)
        dMask = diff([0; activeMask; 0]);
        starts = find(dMask == 1);
        ends = find(dMask == -1) - 1;
        [~, longestIdx] = max(ends - starts);
        selStart = starts(longestIdx);
        selEnd = ends(longestIdx);
    else
        selStart = 1;
        selEnd = length(totalFiltered);
    end
    tSeg = t(selStart:selEnd);
    sigSeg = totalFiltered(selStart:selEnd);

    % FFT com remoção de DC e janela para estimar cadência
    sigZeroMean = sigSeg - mean(sigSeg);
    N = length(sigZeroMean);
    if N < 4
        Y = [];
        P = [];
        f = [];
        freqCadFFT = NaN;
    else
        if exist('hann', 'file')
            w = hann(N);
        else
            w = hanning(N); % fallback Octave
        end
        sigWin = sigZeroMean(:) .* w;
        Y = fft(sigWin);
        P = abs(Y / N);
        f = (0:N-1) * (Fs / N);
        halfIdx = 2:floor(N/2); % ignora DC
        [~, idxPeak] = max(P(halfIdx));
        freqCadFFT = f(halfIdx(idxPeak));
    end

    % Cadência no domínio do tempo via picos
    minProm = 0.2 * max(sigSeg);
    if minProm <= 0
        minProm = 0.1;
    end
    minDist = max(1, round(0.3 / Ts)); % exige ~0.3s entre passos
    [~, pkLocs] = findpeaks(sigSeg, 'MinPeakHeight', minProm, 'MinPeakDistance', minDist);
    if numel(pkLocs) >= 2
        intervals = diff(tSeg(pkLocs));
        freqCadTime = 1 / median(intervals);
    else
        freqCadTime = NaN;
    end

    if ~isnan(freqCadTime)
        freqCadencia = freqCadTime;
    elseif exist('freqCadFFT', 'var') && ~isnan(freqCadFFT)
        freqCadencia = freqCadFFT;
    else
        freqCadencia = 0;
    end

    keyCols = size(filteredSignals, 2);
    sensorIdx = 1:keyCols;
    keyCols = size(filteredSignals, 2);
    sensorIdx = 1:keyCols;
    fsrNames = lower(headers(fsrCols));
    sensorMax = max(filteredSignals, [], 1);
    aliveMask = sensorMax > 1e-3;
    idxHeel = find(strcmp(fsrNames, 'fsr2'), 1);  % calcanhar
    idxMid = find(strcmp(fsrNames, 'fsr4'), 1);   % medio pe lateral
    idxToe1 = find(strcmp(fsrNames, 'fsr1'), 1);  % dedao
    idxToe2 = find(strcmp(fsrNames, 'fsr3'), 1);  % cabeca distal metatarso

    heelTime = NaN; midTime = NaN; toeTime = NaN;
    if ~isempty(idxHeel) && aliveMask(idxHeel)
        [~, heelIdx] = max(filteredSignals(:, idxHeel));
        heelTime = t(heelIdx);
    end
    if ~isempty(idxMid) && aliveMask(idxMid)
        [~, midIdx] = max(filteredSignals(:, idxMid));
        midTime = t(midIdx);
    end
    toeCandidates = [];
    if ~isempty(idxToe1) && aliveMask(idxToe1)
        [~, toeIdx1] = max(filteredSignals(:, idxToe1));
        toeCandidates(end+1) = t(toeIdx1); %#ok<AGROW>
    end
    if ~isempty(idxToe2) && aliveMask(idxToe2)
        [~, toeIdx2] = max(filteredSignals(:, idxToe2));
        toeCandidates(end+1) = t(toeIdx2); %#ok<AGROW>
    end
    if ~isempty(toeCandidates)
        toeTime = min(toeCandidates);
    end

    classificacao = "Indefinida";
    if ~isnan(heelTime) && ~isnan(toeTime) && isnan(midTime)
        if heelTime <= toeTime
            classificacao = "Normal";
        else
            classificacao = "Invertida";
        end
    elseif ~isnan(heelTime) && ~isnan(midTime) && ~isnan(toeTime)
        if heelTime <= midTime && midTime <= toeTime
            classificacao = "Normal";
        else
            classificacao = "Invertida";
        end
    end

    figure('Visible', 'off', 'Position', [100, 100, 1200, 800]);

    subplot(3,1,1);
    plot(t, totalRaw, 'Color', [0.7 0.7 0.7], 'LineWidth', 1.0); hold on;
    plot(t, totalFiltered, 'b', 'LineWidth', 1.3);
    grid on; xlabel('Tempo (s)'); ylabel('Pressao total');
    title('Sinal bruto vs filtrado');
    legend('Bruto', 'Filtrado');

    subplot(3,1,2);
    colors = lines(keyCols);
    for c = 1:keyCols
        denom = max(filteredSignals(:, sensorIdx(c)));
        if denom <= 0
            sigNorm = zeros(size(filteredSignals, 1), 1);
        else
            sigNorm = filteredSignals(:, sensorIdx(c)) / denom;
        end
        plot(t, sigNorm, 'Color', colors(c,:), 'LineWidth', 1.2); hold on;
    end
    grid on; xlabel('Tempo (s)'); ylabel('Amplitude normalizada');
    title('Sequencia de ativacao (sensores fsr1..fsr4)');
    legend(headers(fsrCols), 'Location', 'northeast');

    subplot(3,1,3);
    plot(f(halfIdx), P(halfIdx), 'r', 'LineWidth', 1.2);
    grid on; xlabel('Frequencia (Hz)'); ylabel('|P(f)|');
    title(sprintf('Espectro (Cadencia %.2f Hz)', freqCadencia));

    [~, baseName, ~] = fileparts(files(k).name);
    pngPath = fullfile(outputDir, [baseName, '.png']);
    print(gcf, pngPath, '-dpng', '-r150');
    close(gcf);

    resumo = [resumo; {baseName, freqCadencia, impulso, taxaCargaMax, char(classificacao)}]; %#ok<AGROW>
    fprintf('Processado %s -> %s\n', files(k).name, pngPath);
end

resumoPath = fullfile(outputDir, 'resumo_final.csv');
write_resumo_csv(resumoPath, resumo);
fprintf('Resumo salvo em %s\n', resumoPath);
