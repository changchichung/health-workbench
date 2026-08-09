// 預設 adapter 註冊表：新格式（如 Excel）＝新增模組＋此處 register 一行。
import { createRegistry } from "./registry.js";
import { nhiJsonAdapter } from "./nhi_json.js";
import { nhiXmlAdapter } from "./nhi_xml.js";
import { appleHealthAdapter } from "./apple_health.js";

export const registry = createRegistry();
registry.register(nhiJsonAdapter);
registry.register(nhiXmlAdapter);
registry.register(appleHealthAdapter);
