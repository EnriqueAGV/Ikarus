import { notFound } from "next/navigation";
import { can, requireBusinessAccess } from "@/lib/auth";
import { AttachmentError, readAttachment } from "@/lib/dashboard/attachments";

// Opens an attached file for one of the clinic's doctors, decrypted on the
// way out and never cached.
export async function GET(_req: Request, ctx: RouteContext<"/app/[businessId]/clients/[clientId]/files/[attachmentId]">) {
  const { businessId, clientId, attachmentId } = await ctx.params;
  const membership = await requireBusinessAccess(businessId);
  if (!can(membership, "chart.clinical")) notFound();
  const file = await readAttachment(membership, attachmentId).catch((err) => {
    if (err instanceof AttachmentError) return null;
    throw err;
  });
  if (!file) notFound();
  const { attachment, bytes } = file;
  // The page links each file under its own patient, merged duplicates included.
  if (attachment.clientId !== clientId) notFound();
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": attachment.contentType,
      "Content-Length": String(bytes.length),
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
