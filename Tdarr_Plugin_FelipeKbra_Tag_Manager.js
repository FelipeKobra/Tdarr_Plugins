module.exports.dependencies = [];

const details = () => ({
    id: 'Tdarr_Plugin_FelipeKbra_Tag_Manager',
    Stage: 'Post-processing',
    Name: 'Radarr/Sonarr Tag Manager - Remove and Add Tags',
    Type: 'Video',
    Operation: 'Transcode',
    Description: 'Remove uma tag específica de um filme/série e adiciona outra tag no lugar. Útil para gerenciar tags automaticamente após o processamento de arquivos.',
    Version: '1.0.0',
    Tags: '3rd party,post-processing,configurable,radarr,sonarr,tags',
    Inputs: [
        {
            name: 'radarr_enabled',
            type: 'boolean',
            defaultValue: false,
            inputUI: { type: 'dropdown', options: ['false', 'true'] },
            tooltip: 'Ativar gerenciamento de tags no Radarr (Filmes)',
        },
        {
            name: 'radarr_server',
            type: 'string',
            defaultValue: '192.168.1.100',
            inputUI: { type: 'text' },
            tooltip: 'IP ou Hostname do Radarr',
        },
        {
            name: 'radarr_port',
            type: 'string',
            defaultValue: '7878',
            inputUI: { type: 'text' },
            tooltip: 'Porta do Radarr (Padrão: 7878)',
        },
        {
            name: 'radarr_api_key',
            type: 'string',
            defaultValue: '',
            inputUI: { type: 'text' },
            tooltip: 'Chave de API do Radarr',
        },
        {
            name: 'radarr_tag_to_remove',
            type: 'string',
            defaultValue: 'not-transcoded',
            inputUI: { type: 'text' },
            tooltip: 'Nome da tag a ser removida no Radarr (deixe vazio para não remover nenhuma)',
        },
        {
            name: 'radarr_tag_to_add',
            type: 'string',
            defaultValue: 'transcoded',
            inputUI: { type: 'text' },
            tooltip: 'Nome da tag a ser adicionada no Radarr (deixe vazio para não adicionar nenhuma)',
        },
        {
            name: 'sonarr_enabled',
            type: 'boolean',
            defaultValue: false,
            inputUI: { type: 'dropdown', options: ['false', 'true'] },
            tooltip: 'Ativar gerenciamento de tags no Sonarr (Séries)',
        },
        {
            name: 'sonarr_server',
            type: 'string',
            defaultValue: '192.168.1.100',
            inputUI: { type: 'text' },
            tooltip: 'IP ou Hostname do Sonarr',
        },
        {
            name: 'sonarr_port',
            type: 'string',
            defaultValue: '8989',
            inputUI: { type: 'text' },
            tooltip: 'Porta do Sonarr (Padrão: 8989)',
        },
        {
            name: 'sonarr_api_key',
            type: 'string',
            defaultValue: '',
            inputUI: { type: 'text' },
            tooltip: 'Chave de API do Sonarr',
        },
        {
            name: 'sonarr_tag_to_remove',
            type: 'string',
            defaultValue: 'not-transcoded',
            inputUI: { type: 'text' },
            tooltip: 'Nome da tag a ser removida no Sonarr (deixe vazio para não remover nenhuma)',
        },
        {
            name: 'sonarr_tag_to_add',
            type: 'string',
            defaultValue: 'transcoded',
            inputUI: { type: 'text' },
            tooltip: 'Nome da tag a ser adicionada no Sonarr (deixe vazio para não adicionar nenhuma)',
        },
    ],
});

// Helper function para fazer requisições HTTP/HTTPS nativas
const makeRequest = (url, options, postData = null, mylog) => {
    return new Promise((resolve, reject) => {
        const lib = url.startsWith('https') ? require('https') : require('http');
        
        mylog.push(`[Request] ${options.method || 'GET'}: ${url}`);
        
        const req = lib.request(url, options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const parsedData = JSON.parse(data);
                    resolve({ status: res.statusCode, data: parsedData });
                } catch (e) {
                    resolve({ status: res.statusCode, data: data });
                }
            });
        });

        req.on('error', (err) => {
            mylog.push(`[Network Error] ${err.message}`);
            reject(err);
        });

        if (postData) {
            req.write(JSON.stringify(postData));
        }

        req.end();
    });
};

// Função para criar uma nova tag se não existir
const ensureTagExists = async (baseUrl, apiKey, tagName, mylog) => {
    const tagsUrl = `${baseUrl}/tag?apikey=${apiKey}`;
    
    try {
        // Buscar todas as tags existentes
        const tagsResp = await makeRequest(tagsUrl, { method: 'GET' }, null, mylog);
        
        if (tagsResp.status === 200 && Array.isArray(tagsResp.data)) {
            // Procurar pela tag com o nome especificado
            const existingTag = tagsResp.data.find(t => 
                t.label && t.label.toLowerCase() === tagName.toLowerCase()
            );
            
            if (existingTag) {
                mylog.push(`[Tag] Tag "${tagName}" encontrada (ID: ${existingTag.id})`);
                return existingTag.id;
            }
            
            // Tag não existe, criar nova
            mylog.push(`[Tag] Tag "${tagName}" não existe, criando...`);
            const postOptions = {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                }
            };
            
            const newTagData = { label: tagName };
            const createResp = await makeRequest(tagsUrl, postOptions, newTagData, mylog);
            
            if (createResp.status === 200 || createResp.status === 201) {
                mylog.push(`[Tag] Tag "${tagName}" criada (ID: ${createResp.data.id})`);
                return createResp.data.id;
            } else {
                mylog.push(`[Tag] Erro ao criar tag "${tagName}". Status: ${createResp.status}`);
                return null;
            }
        }
    } catch (error) {
        mylog.push(`[Tag] Erro ao processar tags: ${error.message}`);
        return null;
    }
    
    return null;
};

// Função para encontrar ID de uma tag pelo nome
const findTagIdByName = async (baseUrl, apiKey, tagName, mylog) => {
    const tagsUrl = `${baseUrl}/tag?apikey=${apiKey}`;
    
    try {
        const tagsResp = await makeRequest(tagsUrl, { method: 'GET' }, null, mylog);
        
        if (tagsResp.status === 200 && Array.isArray(tagsResp.data)) {
            const tag = tagsResp.data.find(t => 
                t.label && t.label.toLowerCase() === tagName.toLowerCase()
            );
            
            if (tag) {
                mylog.push(`[Tag] Tag "${tagName}" encontrada (ID: ${tag.id})`);
                return tag.id;
            } else {
                mylog.push(`[Tag] Tag "${tagName}" não encontrada`);
                return null;
            }
        }
    } catch (error) {
        mylog.push(`[Tag] Erro ao buscar tag: ${error.message}`);
        return null;
    }
    
    return null;
};

// Função para processar tags de um filme (Radarr)
const processRadarrTags = async (inputs, fileNameEncoded, mylog) => {
    mylog.push('--- Processamento de Tags do Radarr Iniciado ---');
    
    const baseUrl = `http://${inputs.radarr_server}:${inputs.radarr_port}/api/v3`;
    const srchUrl = `${baseUrl}/parse?apikey=${inputs.radarr_api_key}&title=${fileNameEncoded}`;
    
    try {
        // 1. Procurar o filme pelo nome do arquivo
        const parseResp = await makeRequest(srchUrl, { method: 'GET' }, null, mylog);
        
        if (parseResp.status !== 200 || !parseResp.data || !parseResp.data.movie) {
            mylog.push('[Radarr] Filme não encontrado para este arquivo');
            return;
        }
        
        const movieId = parseResp.data.movie.id;
        const movieTitle = parseResp.data.movie.title;
        mylog.push(`[Radarr] Filme encontrado: "${movieTitle}" (ID: ${movieId})`);
        
        // 2. Obter detalhes completos do filme
        const movieUrl = `${baseUrl}/movie/${movieId}?apikey=${inputs.radarr_api_key}`;
        const movieResp = await makeRequest(movieUrl, { method: 'GET' }, null, mylog);
        
        if (movieResp.status !== 200 || !movieResp.data) {
            mylog.push('[Radarr] Erro ao obter detalhes do filme');
            return;
        }
        
        const movie = movieResp.data;
        let currentTags = movie.tags || [];
        mylog.push(`[Radarr] Tags atuais: [${currentTags.join(', ')}]`);
        
        let tagsModified = false;
        
        // 3. Remover tag se especificada
        if (inputs.radarr_tag_to_remove && inputs.radarr_tag_to_remove.trim()) {
            const tagToRemoveId = await findTagIdByName(
                baseUrl, 
                inputs.radarr_api_key, 
                inputs.radarr_tag_to_remove.trim(), 
                mylog
            );
            
            if (tagToRemoveId !== null) {
                const index = currentTags.indexOf(tagToRemoveId);
                if (index > -1) {
                    currentTags.splice(index, 1);
                    mylog.push(`[Radarr] Tag "${inputs.radarr_tag_to_remove}" removida`);
                    tagsModified = true;
                } else {
                    mylog.push(`[Radarr] Filme não possui a tag "${inputs.radarr_tag_to_remove}"`);
                }
            }
        }
        
        // 4. Adicionar tag se especificada
        if (inputs.radarr_tag_to_add && inputs.radarr_tag_to_add.trim()) {
            const tagToAddId = await ensureTagExists(
                baseUrl, 
                inputs.radarr_api_key, 
                inputs.radarr_tag_to_add.trim(), 
                mylog
            );
            
            if (tagToAddId !== null) {
                if (!currentTags.includes(tagToAddId)) {
                    currentTags.push(tagToAddId);
                    mylog.push(`[Radarr] Tag "${inputs.radarr_tag_to_add}" adicionada`);
                    tagsModified = true;
                } else {
                    mylog.push(`[Radarr] Filme já possui a tag "${inputs.radarr_tag_to_add}"`);
                }
            }
        }
        
        // 5. Atualizar filme se as tags foram modificadas
        if (tagsModified) {
            movie.tags = currentTags;
            
            const putOptions = {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                }
            };
            
            const updateResp = await makeRequest(movieUrl, putOptions, movie, mylog);
            
            if (updateResp.status === 200 || updateResp.status === 202) {
                mylog.push(`[Radarr] Tags atualizadas com sucesso: [${currentTags.join(', ')}]`);
            } else {
                mylog.push(`[Radarr] Erro ao atualizar tags. Status: ${updateResp.status}`);
            }
        } else {
            mylog.push('[Radarr] Nenhuma modificação de tag necessária');
        }
        
    } catch (error) {
        mylog.push(`[Radarr] Erro durante processamento: ${error.message}`);
    }
};

// Função para processar tags de uma série (Sonarr)
const processSonarrTags = async (inputs, fileNameEncoded, mylog) => {
    mylog.push('--- Processamento de Tags do Sonarr Iniciado ---');
    
    const baseUrl = `http://${inputs.sonarr_server}:${inputs.sonarr_port}/api/v3`;
    const srchUrl = `${baseUrl}/parse?apikey=${inputs.sonarr_api_key}&title=${fileNameEncoded}`;
    
    try {
        // 1. Procurar a série pelo nome do arquivo
        const parseResp = await makeRequest(srchUrl, { method: 'GET' }, null, mylog);
        
        if (parseResp.status !== 200 || !parseResp.data || !parseResp.data.series) {
            mylog.push('[Sonarr] Série não encontrada para este arquivo');
            return;
        }
        
        const seriesId = parseResp.data.series.id;
        const seriesTitle = parseResp.data.series.title;
        mylog.push(`[Sonarr] Série encontrada: "${seriesTitle}" (ID: ${seriesId})`);
        
        // 2. Obter detalhes completos da série
        const seriesUrl = `${baseUrl}/series/${seriesId}?apikey=${inputs.sonarr_api_key}`;
        const seriesResp = await makeRequest(seriesUrl, { method: 'GET' }, null, mylog);
        
        if (seriesResp.status !== 200 || !seriesResp.data) {
            mylog.push('[Sonarr] Erro ao obter detalhes da série');
            return;
        }
        
        const series = seriesResp.data;
        let currentTags = series.tags || [];
        mylog.push(`[Sonarr] Tags atuais: [${currentTags.join(', ')}]`);
        
        let tagsModified = false;
        
        // 3. Remover tag se especificada
        if (inputs.sonarr_tag_to_remove && inputs.sonarr_tag_to_remove.trim()) {
            const tagToRemoveId = await findTagIdByName(
                baseUrl, 
                inputs.sonarr_api_key, 
                inputs.sonarr_tag_to_remove.trim(), 
                mylog
            );
            
            if (tagToRemoveId !== null) {
                const index = currentTags.indexOf(tagToRemoveId);
                if (index > -1) {
                    currentTags.splice(index, 1);
                    mylog.push(`[Sonarr] Tag "${inputs.sonarr_tag_to_remove}" removida`);
                    tagsModified = true;
                } else {
                    mylog.push(`[Sonarr] Série não possui a tag "${inputs.sonarr_tag_to_remove}"`);
                }
            }
        }
        
        // 4. Adicionar tag se especificada
        if (inputs.sonarr_tag_to_add && inputs.sonarr_tag_to_add.trim()) {
            const tagToAddId = await ensureTagExists(
                baseUrl, 
                inputs.sonarr_api_key, 
                inputs.sonarr_tag_to_add.trim(), 
                mylog
            );
            
            if (tagToAddId !== null) {
                if (!currentTags.includes(tagToAddId)) {
                    currentTags.push(tagToAddId);
                    mylog.push(`[Sonarr] Tag "${inputs.sonarr_tag_to_add}" adicionada`);
                    tagsModified = true;
                } else {
                    mylog.push(`[Sonarr] Série já possui a tag "${inputs.sonarr_tag_to_add}"`);
                }
            }
        }
        
        // 5. Atualizar série se as tags foram modificadas
        if (tagsModified) {
            series.tags = currentTags;
            
            const putOptions = {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                }
            };
            
            const updateResp = await makeRequest(seriesUrl, putOptions, series, mylog);
            
            if (updateResp.status === 200 || updateResp.status === 202) {
                mylog.push(`[Sonarr] Tags atualizadas com sucesso: [${currentTags.join(', ')}]`);
            } else {
                mylog.push(`[Sonarr] Erro ao atualizar tags. Status: ${updateResp.status}`);
            }
        } else {
            mylog.push('[Sonarr] Nenhuma modificação de tag necessária');
        }
        
    } catch (error) {
        mylog.push(`[Sonarr] Erro durante processamento: ${error.message}`);
    }
};

const plugin = async (file, librarySettings, inputs, otherArguments) => {
    const lib = require('../methods/lib')();
    inputs = lib.loadDefaultValues(inputs, details);

    const mylog = [];
    const response = {
        processFile: false,
        infoLog: ''
    };

    const fileNameEncoded = encodeURIComponent(file.meta.FileName);

    // Processar Radarr se habilitado
    if (String(inputs.radarr_enabled) === 'true') {
        await processRadarrTags(inputs, fileNameEncoded, mylog);
    }

    // Processar Sonarr se habilitado
    if (String(inputs.sonarr_enabled) === 'true') {
        await processSonarrTags(inputs, fileNameEncoded, mylog);
    }

    if (!mylog.length) {
        mylog.push('Radarr e Sonarr estão desabilitados nas configurações do plugin.');
    }

    response.infoLog = mylog.join('\n');
    return response;
};

module.exports.details = details;
module.exports.plugin = plugin;