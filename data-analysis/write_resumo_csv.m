function write_resumo_csv(outPath, resumo)
    % Remove arquivo anterior (caso esteja bloqueado, avisa)
    if exist(outPath, 'file')
        [status, msg] = unlink(outPath);
        if status ~= 0
            error('Nao foi possivel remover %s (talvez aberto em outro programa): %s', outPath, msg);
        end
    end

    fid = fopen(outPath, 'w');
    if fid < 0
        error('Nao foi possivel abrir %s para escrita. Verifique se o arquivo nao esta aberto.', outPath);
    end

    header = {'Paciente', 'Cadencia_Hz', 'Impulso_Total', 'Taxa_Carga_Max', 'Classificacao_Pisada'};
    fprintf(fid, '%s,%s,%s,%s,%s\n', header{:});
    for i = 1:size(resumo, 1)
        fprintf(fid, '%s,%.6f,%.6f,%.6f,%s\n', resumo{i,1}, resumo{i,2}, resumo{i,3}, resumo{i,4}, resumo{i,5});
    end
    fclose(fid);
end
