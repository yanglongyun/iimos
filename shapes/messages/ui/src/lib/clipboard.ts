import { toast } from "../overlay/toast";

export async function copyText(content = "") {
  try {
    await navigator.clipboard.writeText(content);
    toast("已复制");
    return true;
  } catch (error) {
    toast(error instanceof Error ? error.message : "复制失败");
    return false;
  }
}
