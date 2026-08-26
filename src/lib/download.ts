/**
 * Browser download helpers.
 *
 * Every object URL created here is revoked once the click has been dispatched —
 * blobs held by an un-revoked URL stay in memory for the life of the document.
 */
export const downloadBlob = (filename: string, blob: Blob) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Give the browser a tick to start the download before releasing the blob.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export const downloadText = (filename: string, content: string) => {
  downloadBlob(filename, new Blob([content], { type: "text/plain;charset=utf-8" }));
};
