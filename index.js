// 扩展的主脚本
// 以下是一些基本扩展功能的示例

// 你可能需要从 extensions.js 导入 extension_settings, getContext 和 loadExtensionSettings
import { extension_settings, getContext, loadExtensionSettings } from "../../../extensions.js";

// 你可能需要从主脚本导入一些其他函数
import { saveSettingsDebounced } from "../../../../script.js";

// 记录扩展的位置，名称应与仓库名称匹配
const extensionName = "st-extension-example";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;
const extensionSettings = extension_settings[extensionName];
const defaultSettings = {};

// 如果扩展设置存在则加载，否则初始化为默认值
async function loadSettings() {
  // 如果设置不存在则创建
  extension_settings[extensionName] = extension_settings[extensionName] || {};
  if (Object.keys(extension_settings[extensionName]).length === 0) {
    Object.assign(extension_settings[extensionName], defaultSettings);
  }

  // 在UI中更新设置
  $("#example_setting").prop("checked", extension_settings[extensionName].example_setting).trigger("input");
}

// 当UI中的扩展设置发生变化时调用此函数
function onExampleInput(event) {
  const value = Boolean($(event.target).prop("checked"));
  extension_settings[extensionName].example_setting = value;
  saveSettingsDebounced();
}

// 当按钮被点击时调用此函数
function onButtonClick() {
  // 你可以在这里做任何你想做的事
  // 让我们弹出一个显示复选框状态的提示
  toastr.info(
    `The checkbox is ${extension_settings[extensionName].example_setting ? "checked" : "not checked"}`,
    "A popup appeared because you clicked the button!"
  );


  console.log("button clicked");
}

// 当扩展加载时调用此函数
jQuery(async () => {
  // 这是从文件加载HTML的示例
  const settingsHtml = await $.get(`${extensionFolderPath}/example.html`);

  // 将settingsHtml添加到extensions_settings
  // extension_settings和extensions_settings2是设置菜单的左右两列
  // 左侧应该是处理系统功能的扩展，右侧应该是与视觉/UI相关的扩展
  $("#extensions_settings").append(settingsHtml);

  // 这些是监听事件的示例
  $("#my_button").on("click", onButtonClick);
  $("#example_setting").on("input", onExampleInput);

  // 启动时加载设置（如果有的话）
  loadSettings();
});
