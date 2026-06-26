/* eslint-disable */
module.exports.dependencies = [];

const details = () => ({
    id: 'Tdarr_Plugin_FelipeKbra_Tag_Manager',
    Stage: 'Post-processing',
    Name: 'FelipeKbra - Radarr/Sonarr Tag Manager - Remove and Add Tags',
    Type: 'Video',
    Operation: 'Transcode',
    Description: 'Removes a specific tag from a movie/series and adds another tag in its place. Useful for automatically managing tags after file processing.',
    Version: '1.0.0',
    Tags: '3rd party,post-processing,configurable,radarr,sonarr,tags',
    Inputs: [
        {
            name: 'radarr_enabled',
            type: 'boolean',
            defaultValue: false,
            inputUI: { type: 'dropdown', options: ['false', 'true'] },
            tooltip: 'Enable tag management in Radarr (Movies)',
        },
        {
            name: 'radarr_server',
            type: 'string',
            defaultValue: '192.168.1.100',
            inputUI: { type: 'text' },
            tooltip: 'Radarr IP or Hostname',
        },
        {
            name: 'radarr_port',
            type: 'string',
            defaultValue: '7878',
            inputUI: { type: 'text' },
            tooltip: 'Radarr Port (Default: 7878)',
        },
        {
            name: 'radarr_api_key',
            type: 'string',
            defaultValue: '',
            inputUI: { type: 'text' },
            tooltip: 'Your Radarr API Key',
        },
        {
            name: 'radarr_tag_to_remove',
            type: 'string',
            defaultValue: 'not-transcoded',
            inputUI: { type: 'text' },
            tooltip: 'Name of the tag to be removed in Radarr (leave empty to not remove any)',
        },
        {
            name: 'radarr_tag_to_add',
            type: 'string',
            defaultValue: 'transcoded',
            inputUI: { type: 'text' },
            tooltip: 'Name of the tag to be added in Radarr (leave empty to not add any)',
        },
        {
            name: 'sonarr_enabled',
            type: 'boolean',
            defaultValue: false,
            inputUI: { type: 'dropdown', options: ['false', 'true'] },
            tooltip: 'Enable tag management in Sonarr (TV Shows)',
        },
        {
            name: 'sonarr_server',
            type: 'string',
            defaultValue: '192.168.1.100',
            inputUI: { type: 'text' },
            tooltip: 'Sonarr IP or Hostname',
        },
        {
            name: 'sonarr_port',
            type: 'string',
            defaultValue: '8989',
            inputUI: { type: 'text' },
            tooltip: 'Sonarr Port (Default: 8989)',
        },
        {
            name: 'sonarr_api_key',
            type: 'string',
            defaultValue: '',
            inputUI: { type: 'text' },
            tooltip: 'Your Sonarr API Key',
        },
        {
            name: 'sonarr_tag_to_remove',
            type: 'string',
            defaultValue: 'not-transcoded',
            inputUI: { type: 'text' },
            tooltip: 'Name of the tag to be removed in Sonarr (leave empty to not remove any)',
        },
        {
            name: 'sonarr_tag_to_add',
            type: 'string',
            defaultValue: 'transcoded',
            inputUI: { type: 'text' },
            tooltip: 'Name of the tag to be added in Sonarr (leave empty to not add any)',
        },
    ],
});

/**
 * Helper function using native Node.js HTTP/HTTPS modules to execute asynchronous networking
 */
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

/**
 * Validates existence of a tag name, and automatically creates it if missing
 */
const ensureTagExists = async (baseUrl, apiKey, tagName, mylog) => {
    const tagsUrl = `${baseUrl}/tag?apikey=${apiKey}`;
    
    try {
        // Fetch all current tags inside the application database
        const tagsResp = await makeRequest(tagsUrl, { method: 'GET' }, null, mylog);
        
        if (tagsResp.status === 200 && Array.isArray(tagsResp.data)) {
            const existingTag = tagsResp.data.find(t => 
                t.label && t.label.toLowerCase() === tagName.toLowerCase()
            );
            
            if (existingTag) {
                mylog.push(`[Tag] Tag "${tagName}" found (ID: ${existingTag.id})`);
                return existingTag.id;
            }
            
            // Tag does not exist, initialize a creation request payload
            mylog.push(`[Tag] Tag "${tagName}" does not exist, creating...`);
            const postOptions = {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                }
            };
            
            const newTagData = { label: tagName };
            const createResp = await makeRequest(tagsUrl, postOptions, newTagData, mylog);
            
            if (createResp.status === 200 || createResp.status === 201) {
                mylog.push(`[Tag] Tag "${tagName}" created successfully (ID: ${createResp.data.id})`);
                return createResp.data.id;
            } else {
                mylog.push(`[Tag] Error creating tag "${tagName}". Status: ${createResp.status}`);
                return null;
            }
        }
    } catch (error) {
        mylog.push(`[Tag] Error processing tags lifecycle: ${error.message}`);
        return null;
    }
    
    return null;
};

/**
 * Searches for a tag's unique integer ID matching a plaintext string label name
 */
const findTagIdByName = async (baseUrl, apiKey, tagName, mylog) => {
    const tagsUrl = `${baseUrl}/tag?apikey=${apiKey}`;
    
    try {
        const tagsResp = await makeRequest(tagsUrl, { method: 'GET' }, null, mylog);
        
        if (tagsResp.status === 200 && Array.isArray(tagsResp.data)) {
            const tag = tagsResp.data.find(t => 
                t.label && t.label.toLowerCase() === tagName.toLowerCase()
            );
            
            if (tag) {
                mylog.push(`[Tag] Tag "${tagName}" found (ID: ${tag.id})`);
                return tag.id;
            } else {
                mylog.push(`[Tag] Tag "${tagName}" not found`);
                return null;
            }
        }
    } catch (error) {
        mylog.push(`[Tag] Error searching for tag: ${error.message}`);
        return null;
    }
    
    return null;
};

/**
 * Orchestrates Radarr specific media track parsing and tag adjustments
 */
const processRadarrTags = async (inputs, fileNameEncoded, mylog) => {
    mylog.push('--- Radarr Tag Management Processing Started ---');
    
    const baseUrl = `http://${inputs.radarr_server}:${inputs.radarr_port}/api/v3`;
    const srchUrl = `${baseUrl}/parse?apikey=${inputs.radarr_api_key}&title=${fileNameEncoded}`;
    
    try {
        // 1. Resolve which specific Movie payload maps to this active filename
        const parseResp = await makeRequest(srchUrl, { method: 'GET' }, null, mylog);
        
        if (parseResp.status !== 200 || !parseResp.data || !parseResp.data.movie) {
            mylog.push('[Radarr] No matching movie entry found for this filename');
            return;
        }
        
        const movieId = parseResp.data.movie.id;
        const movieTitle = parseResp.data.movie.title;
        mylog.push(`[Radarr] Movie found: "${movieTitle}" (ID: ${movieId})`);
        
        // 2. Extract full database object configurations for this targeted movie entity
        const movieUrl = `${baseUrl}/movie/${movieId}?apikey=${inputs.radarr_api_key}`;
        const movieResp = await makeRequest(movieUrl, { method: 'GET' }, null, mylog);
        
        if (movieResp.status !== 200 || !movieResp.data) {
            mylog.push('[Radarr] Failed to fetch existing movie details metadata');
            return;
        }
        
        const movie = movieResp.data;
        let currentTags = movie.tags || [];
        mylog.push(`[Radarr] Current mapped tag IDs: [${currentTags.join(', ')}]`);
        
        let tagsModified = false;
        
        // 3. Evaluate and discard unwanted target tag definitions
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
                    mylog.push(`[Radarr] Tag "${inputs.radarr_tag_to_remove}" removed successfully`);
                    tagsModified = true;
                } else {
                    mylog.push(`[Radarr] Movie does not possess target tag: "${inputs.radarr_tag_to_remove}"`);
                }
            }
        }
        
        // 4. Evaluate and inject requested tag definitions
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
                    mylog.push(`[Radarr] Tag "${inputs.radarr_tag_to_add}" added successfully`);
                    tagsModified = true;
                } else {
                    mylog.push(`[Radarr] Movie already possesses target tag: "${inputs.radarr_tag_to_add}"`);
                }
            }
        }
        
        // 5. Mux the mutated array variables back into the remote application database
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
                mylog.push(`[Radarr] Tags updated successfully. Current array: [${currentTags.join(', ')}]`);
            } else {
                mylog.push(`[Radarr] Failed to write updated tags back to endpoint. Status: ${updateResp.status}`);
            }
        } else {
            mylog.push('[Radarr] No tag modification actions needed');
        }
        
    } catch (error) {
        mylog.push(`[Radarr] Critical exception encountered during processing: ${error.message}`);
    }
};

/**
 * Orchestrates Sonarr specific show track parsing and tag adjustments
 */
const processSonarrTags = async (inputs, fileNameEncoded, mylog) => {
    mylog.push('--- Sonarr Tag Management Processing Started ---');
    
    const baseUrl = `http://${inputs.sonarr_server}:${inputs.sonarr_port}/api/v3`;
    const srchUrl = `${baseUrl}/parse?apikey=${inputs.sonarr_api_key}&title=${fileNameEncoded}`;
    
    try {
        // 1. Resolve which specific Series payload maps to this active filename
        const parseResp = await makeRequest(srchUrl, { method: 'GET' }, null, mylog);
        
        if (parseResp.status !== 200 || !parseResp.data || !parseResp.data.series) {
            mylog.push('[Sonarr] No matching series entry found for this filename');
            return;
        }
        
        const seriesId = parseResp.data.series.id;
        const seriesTitle = parseResp.data.series.title;
        mylog.push(`[Sonarr] Series found: "${seriesTitle}" (ID: ${seriesId})`);
        
        // 2. Extract full database object configurations for this targeted series entity
        const seriesUrl = `${baseUrl}/series/${seriesId}?apikey=${inputs.sonarr_api_key}`;
        const seriesResp = await makeRequest(seriesUrl, { method: 'GET' }, null, mylog);
        
        if (seriesResp.status !== 200 || !seriesResp.data) {
            mylog.push('[Sonarr] Failed to fetch existing series details metadata');
            return;
        }
        
        const series = seriesResp.data;
        let currentTags = series.tags || [];
        mylog.push(`[Sonarr] Current mapped tag IDs: [${currentTags.join(', ')}]`);
        
        let tagsModified = false;
        
        // 3. Evaluate and discard unwanted target tag definitions
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
                    mylog.push(`[Sonarr] Tag "${inputs.sonarr_tag_to_remove}" removed successfully`);
                    tagsModified = true;
                } else {
                    mylog.push(`[Sonarr] Series does not possess target tag: "${inputs.sonarr_tag_to_remove}"`);
                }
            }
        }
        
        // 4. Evaluate and inject requested tag definitions
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
                    mylog.push(`[Sonarr] Tag "${inputs.sonarr_tag_to_add}" added successfully`);
                    tagsModified = true;
                } else {
                    mylog.push(`[Sonarr] Series already possesses target tag: "${inputs.sonarr_tag_to_add}"`);
                }
            }
        }
        
        // 5. Mux the mutated array variables back into the remote application database
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
                mylog.push(`[Sonarr] Tags updated successfully. Current array: [${currentTags.join(', ')}]`);
            } else {
                mylog.push(`[Sonarr] Failed to write updated tags back to endpoint. Status: ${updateResp.status}`);
            }
        } else {
            mylog.push('[Sonarr] No tag modification actions needed');
        }
        
    } catch (error) {
        mylog.push(`[Sonarr] Critical exception encountered during processing: ${error.message}`);
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

    // Route workflows depending on system control activation parameters
    if (String(inputs.radarr_enabled) === 'true') {
        await processRadarrTags(inputs, fileNameEncoded, mylog);
    }

    if (String(inputs.sonarr_enabled) === 'true') {
        await processSonarrTags(inputs, fileNameEncoded, mylog);
    }

    if (!mylog.length) {
        mylog.push('Both Radarr and Sonarr integration features are disabled in plugin configuration rules.');
    }

    response.infoLog = mylog.join('\n');
    return response;
};

module.exports.details = details;
module.exports.plugin = plugin;