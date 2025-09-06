import { getContext } from "../../../../st-context.js";
import { getWorldInfoSettings, world_names,world_info} from "../../../../world-info.js";

let audioArray = [];


/**
 * 异步函数：获取音效世界信息
 * 该函数用于加载特定世界中的音效资源信息，并将其解析为键值对数组
 * @returns {Promise<void>} 无返回值，但会设置全局变量 yin_xiao_world_info、yin_xiao_zi_yuan 和 audioArray
 */
async function get_yin_xiao_world_info() {
    let context = getContext();
    // 获取当前世界信息设置
    let world = world_info.globalSelect;
    let yin_xiao_world_info = "";

    console.log("world_info", world);

    let name=getContext().characters[getContext().characterId].data.extensions.world;


    console.log("chat_world_name",name)

    let chat_entries;

    if(name){

        let chat_WorldInfo= await getContext().loadWorldInfo(name)

        chat_entries = chat_WorldInfo.entries;

    }
   
    let yin_xiao_zi_yuan ;

    let chat_yin_xiao_zi_yuan;
        // 初始化对象数组
    audioArray = [];


    if(name){

        console.log("chat_entries", chat_entries);

    for (let key in chat_entries) {
       // console.log("entries[i]", chat_entries[key].comment);
        if (chat_entries[key].comment.includes("音效资源")) {
            chat_yin_xiao_zi_yuan = chat_entries[key];
            const chat_yin_xiao_zi_yuan_string = chat_yin_xiao_zi_yuan.content;
            const lines2 = chat_yin_xiao_zi_yuan_string.split('\n');
            lines2.forEach(line => {
                const [key, url,uploader,volume] = line.split('=');
                // 创建对象并推入数组
                if (key && url) {
                    audioArray.push({ key: key.trim(), url: url.trim(), volume: volume ? volume.trim() : 100,uploader: uploader ? uploader.trim() : 'N/A' });
                }
            });
        }
    }

    }else{


        console.log('未找到角色卡音频资源');
    }


        // 遍历所有世界名称，查找包含"声临其境"的世界并加载其信息
        for (let i = 0; i < world.length; i++) {
            let worldname = world[i];
            console.log("worldname", worldname);
            if (worldname.includes("声临其境")) {
                {
                    yin_xiao_world_info = await context.loadWorldInfo(worldname);
                    console.log("yin_xiao_world_info", yin_xiao_world_info);
                }
            }
        }
    
        if (!yin_xiao_world_info) {
            console.log("未找到'声临其境'世界信息");
            return;
        }
    


    console.log("yin_xiao_zi_yuan", yin_xiao_zi_yuan);

    // 获取音效资源的第二个条目
    let entries = yin_xiao_world_info.entries;

    console.log("entries", entries);
    
   for (let key in entries) {
 //   console.log("entries[i]", entries[key].comment);
    if (entries[key].comment.includes("音效资源")) {
        yin_xiao_zi_yuan = entries[key];
        
        // 获取音效资源的内容字符串
        const yin_xiao_zi_yuan_string = yin_xiao_zi_yuan.content;
        
        // 按行分割字符串
        const lines = yin_xiao_zi_yuan_string.split('\n');

        // 遍历每一行并分割键和值，构建音频资源数组
        lines.forEach(line => {
            const [key, url,uploader,volume] = line.split('=');
            // 创建对象并推入数组
            if (key && url) {
                audioArray.push({ key: key.trim(), url: url.trim(), volume: volume ? volume.trim() : 100,uploader: uploader ? uploader.trim() : 'N/A' });
            }
        });
    }
    }

}

/**
 * 搜索音效资源函数
 * @param {String} name - 要搜索的音效资源名称
 * @returns {String} 返回找到的音效资源URL，如果未找到则返回空字符串
 */
function search_yin_xiao_zi_yuan(name) {
    // 输出结果
    console.log("audioArray", audioArray);

    // 查询示例
    const queryKey = name;
    const result = audioArray.find(item => item.key === queryKey);

    if (result) {
        console.log(`查询结果: ${result.key} => ${result.url}`);
        return {url:result.url,volume:result.volume,uploader:result.uploader};
    } else {
        console.log("未找到该键");
        return "";
    }
}

export {
    get_yin_xiao_world_info,
    search_yin_xiao_zi_yuan,
    world_info,
    audioArray,
};
