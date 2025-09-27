import { extension_settings, extensionTypes } from "../../../extensions.js";
import { saveSettingsDebounced,eventSource,event_types} from "../../../../script.js";
import { getContext } from "../../../st-context.js";
import { extensionName } from "./utils/config.js";
import { get_yin_xiao_world_info, search_yin_xiao_zi_yuan ,world_info} from "./utils/world-info.js";
import { ensureAudiosAreCached } from "./utils/audio-cache.js";
import { initAudio } from "./utils/audio-context.js";
import { initUI } from "./utils/ui.js";
import { stopAllAudio, sourceisPlaying, isSfxWaitPlaying } from "./utils/playback.js";
import { CharacterReadingMarker } from "./utils/reading-marker.js";
import { getRequestHeaders, getParagraphOffsetsRange, parseBGMContent, getRegexExtensionSettings } from "./utils/helpers.js";

const nativeConsoleLog = console.log;
extension_settings[extensionName] = extension_settings[extensionName] || {};

let token;
let marker;

let messageend=false;

let world_info1=world_info;


eventSource.on(event_types.GENERATION_STARTED, async (/** @type {any} */ mesid1) => {

    console.log("声临其境插件：检测到生成事件开始！");
    messageend=false;
    
});

eventSource.on(event_types.MESSAGE_RECEIVED, async (/** @type {any} */ mesid1) => {

    console.log("声临其境插件：检测到生成事件结束！");
    if(!messageend){

        messageend=true;
    }else{

        if (extension_settings[extensionName].autoPlay !== true) {
            return;
        }
        setTimeout(() => {
            console.log("声临其境插件：检测到生成事件结束！MESSAGE_RECEIVED");
            console.log("生成消息id:", mesid1);
            const mesTextElement = document.querySelector(`.mes_text[data-mesid="${mesid1}"]`);
           
            if (mesTextElement) {
                 startImmersiveSound(mesTextElement, mesid1);
            }
        }, 1000);

    }
   
    
});


eventSource.on(event_types.GENERATION_ENDED, async (/** @type {any} */ mesid) => {
    console.log("声临其境插件：检测到生成事件结束！");
    if(!messageend){

        messageend=true;
    }else{

        if (extension_settings[extensionName].autoPlay !== true) {
            return;
        }
        setTimeout(() => {
            console.log("声临其境插件：检测到生成事件结束！GENERATION_ENDED");
            console.log("生成消息id:", mesid-1);
            const mesTextElement = document.querySelector(`.mes_text[data-mesid="${mesid-1}"]`);
           
            if (mesTextElement) {
                 startImmersiveSound(mesTextElement, mesid-1);
            }
        }, 1000);
    }
    
});


function getExtensionType(externalId) {
    const id = Object.keys(extensionTypes).find(
        (id) => id === externalId || (id.startsWith('third-party') && id.endsWith(externalId)),
    );
    return id ? extensionTypes[id] : 'local';
}

async function check_update() {
    const global = getExtensionType(extensionName) === 'global' ? true : false;

    const reload = () => {
        toastr.success(`成功更新插件`);
        console.log(`成功更新插件`);
        setTimeout(() => location.reload(), 4000);
    };

    const update_response = await update_extension(extensionName, global);
    if (update_response.ok) {
        if ((await update_response.json()).isUpToDate) {
            toastr.success("插件是最新版本");
            console.log("插件是最新版本");
        } else {
            reload();
        }
        return true;
    }
}

async function update_extension(extensionname, global) {
    const response = await fetch('/api/extensions/update', {
        method: 'POST',
        headers: getRequestHeaders(token),
        body: JSON.stringify({ extensionName: extensionname, global }),
    });
    return response;
}

jQuery(async () => {
    try {
        const context = getContext();
        console.log("context", context);    
        const tokenResponse = await fetch('/csrf-token');
        const data = await tokenResponse.json();
        token = data.token;
    } catch (err) {
        console.error('Initialization failed', err);
        throw new Error('Initialization failed');
    }

    initAudio();
    await initUI({ check_update });
  //  window.showYinXiaoSettingsPanel();

    const ster = setInterval(() => {
        const targetElement = document.querySelector('#option_toggle_AN');
        if (targetElement) {
            clearInterval(ster);
            if (!document.getElementById('option_toggle_AN2')) {
                const newElement = document.createElement('a');
                newElement.id = 'option_toggle_AN2';
                const icon = document.createElement('i');
                icon.className = 'fa-lg fa-solid fa-note-sticky';
                newElement.appendChild(icon);
                const span = document.createElement('span');
                span.setAttribute('data-i184n', "打开设置");
                span.textContent = '打开声临其境设置';
                newElement.appendChild(span);
                targetElement.parentNode.insertBefore(newElement, targetElement.nextSibling);
                console.log("New element added successfully");
                document.getElementById('option_toggle_AN2').addEventListener('click', window.showYinXiaoSettingsPanel);
            }
        }
    }, 1000);
});

const intervalId = setInterval(() => p_addEventListener(), 2000);

async function startImmersiveSound(mesTextElement, thisMesid) {
    nativeConsoleLog("声临其境: 触发播放");
    if (window.isImmersiveSoundPreparing) {
        toastr.warning('正在处理中，请勿重复点击。');
        nativeConsoleLog('st-immersive-sound is busy.');
        return;
    }
    nativeConsoleLog("getContext2", getContext());

    window.isImmersiveSoundPreparing = true;
    try {
        if (!extension_settings[extensionName].enable_plugin) {
            nativeConsoleLog("声临其境 plugin is disabled.");
            return;
        }

        if (marker && (marker.isPlaying || isSfxWaitPlaying()) && marker.element === mesTextElement) {
            stopAllAudio(marker);
            marker = null;
            return;
        }

        if (window.currentReadingInterval) {
            clearInterval(window.currentReadingInterval);
            document.querySelectorAll('.reading-highlight').forEach(span => {
                const parent = span.parentNode;
                parent.replaceChild(document.createTextNode(span.textContent), span);
                parent.normalize();
            });
        }

        for (const key in sourceisPlaying) {
            sourceisPlaying[key] = false;
        }

        if (marker) {
            marker.stop();
        }

        const fullMesText = mesTextElement.textContent;
        let RegexExtensionSettings = await getRegexExtensionSettings();
        const context = getContext();
        const mestest = context.chat[thisMesid].mes;
        let bgmlist = parseBGMContent(mestest);

        

            for (const key in bgmlist) {
                if (Object.hasOwnProperty.call(bgmlist, key)) {
                    const bgmCategory = bgmlist[key];
                    for (let i = 0; i < bgmCategory.length; i++) {
                        let bgm = bgmCategory[i];

                        if (bgm.regex_start) {
                            bgm.regex_start = bgm.regex_start.replaceAll("‘", "“");
                            bgm.regex_start = bgm.regex_start.replaceAll("’", "”");
                            bgm.regex_start = bgm.regex_start.replaceAll(",", "，");
                            bgm.regex_start = bgm.regex_start.replaceAll("...", "…");
                        }
                        if (bgm.regex_end) {
                            bgm.regex_end = bgm.regex_end.replaceAll("‘", "“");
                            bgm.regex_end = bgm.regex_end.replaceAll("’", "”");
                            bgm.regex_end = bgm.regex_end.replaceAll(",", "，");
                            bgm.regex_end = bgm.regex_end.replaceAll("...", "…");
                        }
                        if (bgm.regex) {
                            bgm.regex = bgm.regex.replaceAll("‘", "“");
                            bgm.regex = bgm.regex.replaceAll("’", "”");
                            bgm.regex = bgm.regex.replaceAll(",", "，");
                            bgm.regex = bgm.regex.replaceAll("...", "…");
                        }

                        if (extension_settings[extensionName].regexReplace) {
                        for (let j = 0; j < RegexExtensionSettings.length; j++) {
                            if (bgm.regex_start) {
                                bgm.regex_start = bgm.regex_start.replace(RegexExtensionSettings[j].findRegex, RegexExtensionSettings[j].replaceString);
                            }
                            if (bgm.regex_end) {
                                bgm.regex_end = bgm.regex_end.replace(RegexExtensionSettings[j].findRegex, RegexExtensionSettings[j].replaceString);
                            }
                            if (bgm.regex) {
                                bgm.regex = bgm.regex.replace(RegexExtensionSettings[j].findRegex, RegexExtensionSettings[j].replaceString);
                            }
                        }
                    }
                    }
                }
            }
        

        nativeConsoleLog("bgmlist:", bgmlist);
        await get_yin_xiao_world_info();
        stopAllAudio();

        let musicList = [];

        if (bgmlist) {
            const categories = ["Music", "Ambiance", "SFX", "SFX_WAIT", "VOICE"];
            let lastMusicEnd = -1;
            for (const category of categories) {
                if (bgmlist.hasOwnProperty(category)) {
                    for (let i = 0; i < bgmlist[category].length; i++) {
                        let music = {};
                        const bgmItem = bgmlist[category][i];
                        if (bgmItem.loop === true) {
                            let isFirstMusic = category === "Music" && i === 0;
                            let isMusic = category === "Music";
                            let re = getParagraphOffsetsRange(fullMesText, bgmItem.regex_start, bgmItem.regex_end, bgmItem.src, isFirstMusic, extension_settings[extensionName], lastMusicEnd, isMusic);

                            if (re[0] === -1) {
                                nativeConsoleLog(`Skipping looped audio due to invalid/missing start/end markers for ${category}:`, bgmItem);
                                toastr.error(re[1]);
                                lastMusicEnd = -1;
                                continue;
                            } else {
                                music.regex_start = re[0];
                            }


                            music.regex_end = re[1];
                            lastMusicEnd = re[1];

                        } else {
                            if (!bgmItem.regex) {
                                const errorMsg = `音频《${bgmItem.src}》无效的 regex 触发词: "${bgmItem.regex}"`;
                                nativeConsoleLog(errorMsg);
                                toastr.error(errorMsg);
                                continue;
                            }
                            music.regex = fullMesText.indexOf(bgmItem.regex);
                            if (music.regex === -1&& bgmItem.regex.length > 5) {
                                const modifiedParagraph1 = bgmItem.regex.slice(2, -1);
                                music.regex = fullMesText.indexOf(modifiedParagraph1);
                            }

                            if(music.regex === -1){
                                const errorMsg = `音频《${bgmItem.src}》未在文本中找到 regex 触发词: "${bgmItem.regex}"`;
                                nativeConsoleLog(errorMsg);
                                toastr.error(errorMsg);
                                continue;
                            }


                        }

                        music.src = bgmItem.src;
                        music.volume = bgmItem.volume;
                        music.loop = bgmItem.loop;
                        music.type = category;

                        let audio_info = search_yin_xiao_zi_yuan(bgmItem.src);
                        nativeConsoleLog("bgmItem.src", bgmItem.src);
                        if (audio_info && audio_info.url) {
                            music.url = audio_info.url;
                            music.uploader = audio_info.uploader;
                            music.volume = audio_info.volume;
                            music.vibration = audio_info.vibration;

                            console.log("vibration", audio_info.vibration);
                        } else {
                            toastr.error(`未找到音乐文件：${bgmItem.src}`);
                            nativeConsoleLog(`未找到音乐文件：${bgmItem.src}`);
                            continue;
                        }
                        musicList.push(music);
                    }
                }
            }
        }

        nativeConsoleLog("musicList", musicList);


        if (musicList.length === 0) {
            toastr.error("无可播放音频。请检查当前对话是否正确生成BGM标签！");
            return;
        }

        nativeConsoleLog("musicListlength", musicList.length);

        const selection = window.getSelection();
        const startNode = selection.anchorNode;
        const startOffset = selection.anchorOffset;

        await ensureAudiosAreCached(musicList);

        const colorHex = extension_settings[extensionName].highlightColor || '#007BFF';
        const opacity = extension_settings[extensionName].highlightOpacity ?? 0.4;

        const r = parseInt(colorHex.slice(1, 3), 16);
        const g = parseInt(colorHex.slice(3, 5), 16);
        const b = parseInt(colorHex.slice(5, 7), 16);

        const highlightColorRgba = `rgba(${r}, ${g}, ${b}, ${opacity})`;

        marker = new CharacterReadingMarker(
            mesTextElement,
            {
                cpm: extension_settings[extensionName].readingSpeed || 600,
                highlightColor: highlightColorRgba,
                textColor: extension_settings[extensionName].textColor || '#FFFFFF',
                hideBorder: true,
                skipSpaces: false,
                pulseAnimation: true,
                startNode: startNode,
                startOffset: startOffset,
                musicList: musicList,
                onComplete: () => {
                    nativeConsoleLog('阅读完成！');
                }
            }
        );

        window.marker = marker;

        nativeConsoleLog("marker", marker);
        marker.start();
    } finally {
        window.isImmersiveSoundPreparing = false;
    }
}

function p_addEventListener() {
    let ps = document.getElementsByClassName("mes_text");
    for (let i = 0; i < ps.length; i++) {
        let p = ps[i];
        let mesid = p.parentNode.parentNode.getAttribute("mesid");
        p.dataset.mesid = mesid;

        if (!p.hasyinxiao == true) {
            p.hasyinxiao = true;
            p.addEventListener("click", async function (event) {
                if (event.target.nodeType === Node.ELEMENT_NODE && event.detail === 2) { // 二击触发
                    const mesTextElement = event.currentTarget;
                    const thisMesid = mesTextElement.dataset.mesid;
                    await startImmersiveSound(mesTextElement, thisMesid);
                }
            });
        }
    }
}
