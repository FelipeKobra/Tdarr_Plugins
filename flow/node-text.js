// Portuguese names, descriptions, field labels and look of the local flow nodes.
const LOOKS = {
  video: { style: { borderColor: "#b388ff" } },
  audio: { style: { borderColor: "#4fc3f7" } },
  legendas: { style: { borderColor: "#ffd54f" } },
  faixas: { style: { borderColor: "#80cbc4" } },
  arquivo: { style: { borderColor: "#81c784" } },
};
const NEXT = "Continuar para o próximo passo";
const TEXT = {
  removeImages: { icon: "faFilm", desc: "Remove capas e imagens guardadas como faixa de vídeo (MJPEG, PNG, GIF).\n\nEssas faixas não têm utilidade na reprodução e confundem alguns players." },
  cleanSubtitles: { icon: "faClosedCaptioning", desc: "Mantém só as legendas nos idiomas escolhidos e remove comentários, audiodescrição e SDH.\n\nLegendas sem idioma recebem o idioma padrão, para aparecerem com nome certo no Jellyfin.",
    inputs: { languages: ["Idiomas das legendas", "Códigos ISO 639-2 separados por vírgula. Ex.: eng,por,spa"], tagLanguage: ["Idioma padrão", "Usado em legendas que não informam o idioma."] } },
  keepNativeLanguages: { icon: "faLanguage", desc: "Mantém o áudio no idioma original da obra, inglês, os idiomas extras e faixas sem idioma. O restante é removido.\n\nO idioma original vem do Radarr ou do Sonarr. Se não for possível descobri-lo, nenhuma faixa é removida.",
    inputs: { priority: ["Consultar primeiro", "radarr ou sonarr. Vem da variável de biblioteca arr_priority."], user_langs: ["Idiomas extras", "Códigos ISO 639-2 separados por vírgula. Ex.: por"], api_key: ["Chave do TMDB", "Vem da variável global tmdb_api_key."], radarr_api_key: ["Chave do Radarr", "Vem da variável global radarr_api_key."], radarr_url: ["Endereço do Radarr", "Vem da variável global radarr_url."], sonarr_api_key: ["Chave do Sonarr", "Vem da variável global sonarr_api_key."], sonarr_url: ["Endereço do Sonarr", "Vem da variável global sonarr_url."] } },
  smartAudioCleanup: { icon: "faBroom", desc: "Remove faixas de comentário e duplicatas sem identificação.\n\nFaixa estéreo sem título ao lado de um surround é tratada como comentário provável. A faixa principal de cada idioma é sempre preservada." },
  removeAttachments: { icon: "faTrash", desc: "Remove anexos do arquivo, como fontes e capas embutidas.\n\nCom as legendas em SRT, as fontes deixam de ser usadas." },
  convertAudio: { icon: "faVolumeHigh", desc: "Garante um áudio que qualquer aparelho reproduz sem transcodificar.\n\nMono e estéreo viram AAC. Cada faixa surround sem versão estéreo no mesmo idioma ganha um downmix AAC 2.0.",
    inputs: { aacBitrate: ["Bitrate do AAC estéreo", "Ex.: 192k. Faixas mono usam a metade."] } },
  removeByChannelCount: { icon: "faScissors", desc: "Remove as faixas surround depois que a versão estéreo foi garantida.\n\nSe a remoção eliminaria todo o áudio, nada é removido.",
    inputs: { channelCounts: ["Canais a remover", "Quantidades de canais separadas por vírgula. Ex.: 3,6,7,8"] } },
  extractSubtitles: { icon: "faClosedCaptioning", desc: "Salva as legendas de texto como arquivos .srt ao lado do filme e tira todas as legendas de dentro do vídeo.\n\nA extração acontece no mesmo ffmpeg do restante. SRT que já existe não é sobrescrito.",
    inputs: { codecs: ["Formatos a extrair", "Formatos de legenda de texto separados por vírgula."] } },
  removeUnwantedCodecs: { icon: "faTags", desc: "Remove formatos de áudio e legenda que exigiriam transcodificação nos aparelhos, como DTS, TrueHD e PGS.\n\nCuidado: formatos listados aqui saem do arquivo final.",
    inputs: { subtitleCodecs: ["Legendas a remover", "Formatos de legenda separados por vírgula."], audioCodecs: ["Áudios a remover", "Formatos de áudio separados por vírgula."] } },
  ensureAudio: { icon: "faShieldHalved", desc: "Trava de segurança: se o original tem áudio e nenhuma faixa sobraria, o job é interrompido antes de gravar qualquer coisa.\n\nO arquivo original fica intacto." },
  reorderStreams: { icon: "faListOl", desc: "Organiza as faixas: vídeo primeiro, depois áudio e legendas, com português antes de inglês.\n\nAssim os players escolhem a faixa certa por padrão.",
    inputs: { languages: ["Ordem dos idiomas", "Códigos separados por vírgula, do primeiro ao último."], channels: ["Ordem dos canais", "Ex.: 2,1,5.1,7.1"], codecs: ["Formatos primeiro", "Formatos que vêm antes dos demais."] } },
  conformMkv: { icon: "faFileVideo", desc: "Define MKV como formato final e remove o que esse formato não aceita.\n\nFormatos antigos como AVI e TS recebem correção de tempo para evitar dessincronia." },
  hdrToSdr: { icon: "faSun", desc: "Converte HDR10, HLG e Dolby Vision para SDR com tone mapping BT.2390 na GPU, para ficar correto em telas comuns.\n\nArquivos 4K são reduzidos para 1080p. Arquivos SDR passam direto.",
    inputs: { cq: ["Qualidade (CQ)", "Quanto menor, melhor a qualidade e maior o arquivo."], max_bitrate_1080p: ["Bitrate máximo 1080p", "Em kbps. Nunca passa do bitrate do original."], max_bitrate_4KUHD: ["Bitrate máximo 4K", "Em kbps. Só vale se a redução para 1080p estiver desligada."], downscale_4k_to_1080p: ["Reduzir 4K para 1080p", "true ou false."] } },
  nvencEncode: { icon: "faMicrochip", desc: "Converte para HEVC 10-bit com NVENC quando compensa: H.264 acima do teto da resolução, HEVC muito pesado ou 4K.\n\nArquivos bons ficam como estão. Quem já passou pelo encode é reconhecido e não é refeito." },
  prepareExecute: { icon: "faLayerGroup", desc: "Junta tudo o que os passos anteriores decidiram em um único comando.\n\nSe não há nada a fazer, nada é gravado no disco." },
  processarArquivo: { icon: "faBolt", desc: "Executa o ffmpeg uma única vez e faz tudo de uma só vez: limpeza, conversão de áudio, extração de legendas e encode.\n\nÉ o passo demorado. O resumo do que está sendo feito aparece no botão i do worker, em Process reasons." },
  cleanSubtitleTags: { icon: "faClosedCaptioning", desc: "Limpa os arquivos .srt, removendo marcações de posição e de estilo que aparecem como texto em alguns players." },
  keepOriginalDate: { icon: "faCalendarCheck", desc: "Devolve ao arquivo novo a data do original, para ele não aparecer como recém-adicionado no Jellyfin." },
};
module.exports = { LOOKS, NEXT, TEXT };
