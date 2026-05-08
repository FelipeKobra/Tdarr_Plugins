module.exports.dependencies = [];

const details = () => ({
    id: 'Tdarr_Plugin_FelipeKbra_reload_media_on_radarr_or_sonarr',
    Stage: 'Post-processing',
    Name: 'Notify Radarr and/or Sonarr of Media Changes',
    Type: 'Video',
    Operation: 'Transcode',
    Description: 'This plugin triggers a library refresh in Radarr or Sonarr after a file has been processed. This ensures the *arr apps see the updated file size/metadata immediately.',
    Version: '2.0.0',
    Tags: '3rd party,post-processing,configurable,radarr,sonarr',
    Inputs: [
        {
            name: 'radarr_enabled',
            type: 'boolean',
            defaultValue: false,
            inputUI: { type: 'dropdown', options: ['false', 'true'] },
            tooltip: 'Enable notifications for Radarr (Movies)',
        },
        {
            name: 'radarr_server',
            type: 'string',
            defaultValue: '192.168.1.100',
            inputUI: { type: 'text' },
            tooltip: `Radarr IP or Hostname`,
        },
        {
            name: 'radarr_port',
            type: 'string',
            defaultValue: '7878',
            inputUI: { type: 'text' },
            tooltip: `Radarr Port (Default: 7878)`,
        },
        {
            name: 'radarr_api_key',
            type: 'string',
            defaultValue: '',
            inputUI: { type: 'text' },
            tooltip: `Your Radarr API Key`,
        },
        {
            name: 'sonarr_enabled',
            type: 'boolean',
            defaultValue: false,
            inputUI: { type: 'dropdown', options: ['false', 'true'] },
            tooltip: 'Enable notifications for Sonarr (TV Shows)',
        },
        {
            name: 'sonarr_server',
            type: 'string',
            defaultValue: '192.168.1.100',
            inputUI: { type: 'text' },
            tooltip: `Sonarr IP or Hostname`,
        },
        {
            name: 'sonarr_port',
            type: 'string',
            defaultValue: '8989',
            inputUI: { type: 'text' },
            tooltip: `Sonarr Port (Default: 8989)`,
        },
        {
            name: 'sonarr_api_key',
            type: 'string',
            defaultValue: '',
            inputUI: { type: 'text' },
            tooltip: `Your Sonarr API Key`,
        },
    ],
});

// Helper function using native http/https modules
const makeRequest = (url, options, postData = null, mylog) => {
    return new Promise((resolve, reject) => {
        const lib = url.startsWith('https') ? require('https') : require('http');
        
        mylog.push(`[Request] Calling: ${url}`);
        
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

const plugin = async (file, librarySettings, inputs, otherArguments) => {
    const lib = require('../methods/lib')();
    inputs = lib.loadDefaultValues(inputs, details);

    const mylog = [];
    const response = {
        processFile: false,
        infoLog: ''
    };

    const fileNameEncoded = encodeURIComponent(file.meta.FileName);

    // ---
    // RADARR LOGIC
    // ---
    if (String(inputs.radarr_enabled) === 'true') {
        mylog.push('--- Radarr Task Started ---');
        const baseUrl = `http://${inputs.radarr_server}:${inputs.radarr_port}/api/v3`;
        const srchUrl = `${baseUrl}/parse?apikey=${inputs.radarr_api_key}&title=${fileNameEncoded}`;
        const postUrl = `${baseUrl}/command?apikey=${inputs.radarr_api_key}`;

        try {
            const radarrResp = await makeRequest(srchUrl, { method: 'GET' }, null, mylog);
            
            if (radarrResp.status === 200 && radarrResp.data && radarrResp.data.movie) {
                const movieId = radarrResp.data.movie.id;
                const movieTitle = radarrResp.data.movie.title;
                mylog.push(`[Radarr] Found Match: "${movieTitle}" (ID: ${movieId})`);

                const postData = { name: 'RefreshMovie', movieIds: [movieId] };
                const postOptions = {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(JSON.stringify(postData))
                    }
                };

                const postResp = await makeRequest(postUrl, postOptions, postData, mylog);
                mylog.push(`[Radarr] Command Sent: ${postResp.data.commandName || 'Refresh'} | Status: ${postResp.data.status || 'Success'}`);
            } else {
                mylog.push(`[Radarr] Could not find a movie matching file: ${file.meta.FileName}`);
            }
        } catch (error) {
            mylog.push(`[Radarr] Error occurred during API communication.`);
        }
    }

    // ---
    // SONARR LOGIC
    // ---
    if (String(inputs.sonarr_enabled) === 'true') {
        mylog.push('--- Sonarr Task Started ---');
        const baseUrl = `http://${inputs.sonarr_server}:${inputs.sonarr_port}/api/v3`;
        const srchUrl = `${baseUrl}/parse?apikey=${inputs.sonarr_api_key}&title=${fileNameEncoded}`;
        const postUrl = `${baseUrl}/command?apikey=${inputs.sonarr_api_key}`;

        try {
            const sonarrResp = await makeRequest(srchUrl, { method: 'GET' }, null, mylog);
            
            if (sonarrResp.status === 200 && sonarrResp.data && sonarrResp.data.series) {
                const seriesId = sonarrResp.data.series.id;
                const seriesTitle = sonarrResp.data.series.title;
                mylog.push(`[Sonarr] Found Match: "${seriesTitle}" (ID: ${seriesId})`);

                const postData = { name: 'RefreshSeries', seriesId: seriesId };
                const postOptions = {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(JSON.stringify(postData))
                    }
                };

                const postResp = await makeRequest(postUrl, postOptions, postData, mylog);
                mylog.push(`[Sonarr] Command Sent: ${postResp.data.commandName || 'Refresh'} | Status: ${postResp.data.status || 'Success'}`);
            } else {
                mylog.push(`[Sonarr] Could not find a series matching file: ${file.meta.FileName}`);
            }
        } catch (error) {
            mylog.push(`[Sonarr] Error occurred during API communication.`);
        }
    }

    if (!mylog.length) mylog.push('Both Radarr and Sonarr are disabled in plugin settings.');

    response.infoLog = mylog.join('\n');
    return response;
};

module.exports.details = details;
module.exports.plugin = plugin;