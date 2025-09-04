import { getContext } from "../../../../st-context.js";

function getRequestHeaders(token) {
    return {
        'Content-Type': 'application/json',
        'X-CSRF-Token': token,
    };
}

function getParagraphOffsetsRange(fullText, paragraph1, paragraph2, src, isFirstMusic = false, settings = {},lastMusicEnd,isMusic) {
    console.log("src", src);

    console.log("settings.seamlessMusic",settings.seamlessMusic)
    // 检查输入是否有效，不允许空字符串
    if (!paragraph1 || !paragraph2) {
        
        return [-1,`音频《${src}》起始或结束段落无效或为空。起始: "${paragraph1}", 结束: "${paragraph2}"`];
    }

    // 查找段落1在全文中的开始位置
    let startOffset;

    if (settings.musicStartsWithParagraph && isFirstMusic && isMusic) {
        startOffset = 0;
    } else {
        startOffset = fullText.indexOf(paragraph1);
    }

    // 如果找不到，尝试修改后再次查找
    if (startOffset === -1 ) {
        const modifiedParagraph1 = paragraph1.slice(2, -1);
        startOffset = fullText.indexOf(modifiedParagraph1);
        // 如果找到了，更新 paragraph1 的值，以便后续计算 searchStartPosition
        if (startOffset !== -1 && paragraph1.length > 5) {
            paragraph1 = modifiedParagraph1;
           // toastr.success(`音频《${src}》在文本中去除头尾后找到起始段落: "${paragraph1}"`);
        } else {
            if(lastMusicEnd !==-1 && isMusic && settings.seamlessMusic){
                startOffset = lastMusicEnd;
            }else{
                return [-1,`音频《${src}》未在文本中找到起始段落: "${paragraph1}"`]
            };
        }
    }

    // 从段落1结束位置之后开始查找段落2
    const searchStartPosition = startOffset + paragraph1.length;
    let paragraph2StartOffset = fullText.indexOf(paragraph2, searchStartPosition);

    // 如果找不到，尝试修改后再次查找
    if (paragraph2StartOffset === -1) {
        const modifiedParagraph2 = paragraph2.slice(2, -1);
        paragraph2StartOffset = fullText.indexOf(modifiedParagraph2, searchStartPosition);
        // 如果找到了，更新 paragraph2 的值，以便后续计算 endOffset
        if (paragraph2StartOffset !== -1) {
            paragraph2 = modifiedParagraph2;
            toastr.success(`音频《${src}》在文本中去除头尾后找到结束段落: "${paragraph2}"`);
        } else {
           
            console.log(`未在起始段落后找到结束段落 for ${src}`, paragraph1, paragraph2, searchStartPosition, startOffset, fullText);
            return [-1,`音频《${src}》未在起始段落后找到结束段落: "${paragraph2}"`];
        }
    }

    // 计算段落2的结束位置（开始位置 + 段落长度）
    const endOffset = paragraph2StartOffset + paragraph2.length;

    // 返回范围偏移量
    return [startOffset, endOffset];
}

function parseBGMContent(bgmText) {
    // 提取各个部分的内容
    const musicMatch = bgmText.match(/<Music>([\s\S]*?)<\/Music>/);
    const ambianceMatch = bgmText.match(/<Ambiance>([\s\S]*?)<\/Ambiance>/);
    const sfxMatch = bgmText.match(/<SFX>([\s\S]*?)<\/SFX>/);
    const sfxWaitMatch = bgmText.match(/<SFX_WAIT>([\s\S]*?)<\/SFX_WAIT>/);

    // 解析单个音频项的函数
    function parseAudioItem(itemText) {
        const params = {};

        // 提取 src
        const srcMatch = itemText.match(/src=([^,\s\]]+)/);
        if (srcMatch) params.src = srcMatch[1].replaceAll('-', '');

        // // 提取 volume
        // const volumeMatch = itemText.match(/volume=(\d+)/);
        // if (volumeMatch) params.volume = parseInt(volumeMatch[1]);

        // 提取 loop
        const loopMatch = itemText.match(/loop[=:](\w+)/);
        if (loopMatch) params.loop = loopMatch[1] === 'true';

        // 提取 regex_start
        const regexStartMatch = itemText.match(/regex_start=\/(.*?)\//);
        if (regexStartMatch) params.regex_start = regexStartMatch[1].trim();

        // 提取 regex_end
        const regexEndMatch = itemText.match(/regex_end=\/(.*?)\//);
        if (regexEndMatch) params.regex_end = regexEndMatch[1].trim();

        // 提取 regex (单独的regex参数)
        const regexMatch = itemText.match(/regex[=:]\/(.*?)\//);
        if (regexMatch) params.regex = regexMatch[1].trim();

        return params;
    }

    // 解析多个音频项的函数
    function parseMultipleItems(text) {
        if (!text) return [];

        // 匹配所有 [...] 格式的项
        const itemMatches = text.match(/\[[^\]]+\]/g);
        if (!itemMatches) return [];

        return itemMatches.map(item => parseAudioItem(item));
    }

    // 构建结果对象
    const result = {
        Music: [],
        Ambiance: [],
        SFX: [],
        SFX_WAIT: []
    };

    // 解析各部分
    if (musicMatch) {
        result.Music = parseMultipleItems(musicMatch[1]);
    }

    if (ambianceMatch) {
        result.Ambiance = parseMultipleItems(ambianceMatch[1]);
    }

    if (sfxMatch) {
        result.SFX = parseMultipleItems(sfxMatch[1]);
    }

    if (sfxWaitMatch) {
        result.SFX_WAIT = parseMultipleItems(sfxWaitMatch[1]);
    }

    return result;
}

async function getRegexExtensionSettings() {
    const context = getContext();
    const settings = context.extensionSettings["regex"];
    const regex = [];

    if (!settings) {
        return [];
    }

    for (let i = 0; i < settings.length; i++) {
        const setting = settings[i];

        if (setting.disabled) continue;
        if (!setting.markdownOnly) continue;

        let out=false;

       let placement= setting.placement

       for (let j = 0; j < placement.length; j++) {
           if (placement[j]==2){
            out=true;
           }
       }

       if (!out) continue;

        const findRegexString = setting.findRegex;
        const replaceString = setting.replaceString;

        if (!findRegexString) continue;

        // Updated logic to parse regex string with flags
        const match = findRegexString.match(/^\/(.*)\/([gimuy]*)$/);
        let re;

        try {
            if (match) {
                // It's in /pattern/flags format
                const pattern = match[1];
                const flags = match[2];
                re = new RegExp(pattern, flags);
            } else {
                // It's just a pattern string, no delimiters
                re = new RegExp(findRegexString);
            }
            regex.push({ findRegex: re, replaceString: replaceString });
        } catch (e) {
            console.error(`Invalid regular expression: "${findRegexString}".`, e);
        }
    }

    return regex;
}

export {
    getRequestHeaders,
    getParagraphOffsetsRange,
    parseBGMContent,
    getRegexExtensionSettings,
};
