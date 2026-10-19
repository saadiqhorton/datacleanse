import { redirect } from "next/navigation";

/** Review needs a file. The file list is where one is picked. */
export default function ReviewIndexPage() {
  redirect("/files");
}
