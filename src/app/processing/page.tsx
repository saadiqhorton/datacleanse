import { redirect } from "next/navigation";

/** Processing is per file: /processing/<fileId>. The bare route goes to the file list. */
export default function ProcessingIndexPage() {
  redirect("/files");
}
