function data = read_csv_matrix(filePath)
    fid = fopen(filePath, 'r');
    if fid < 0
        error('Nao foi possivel abrir %s', filePath);
    end
    headerLine = fgetl(fid);
    fclose(fid);
    headers = strsplit(strtrim(headerLine), ',');
    % Lemos apenas os numeros a partir da segunda linha (linha 1 zero-based)
    matrix = dlmread(filePath, ',', 1, 0);
    data.headers = headers;
    data.matrix = matrix;
end
