/**
 * Encodes a SharePoint/OneDrive sharing URL into a Microsoft Graph share ID ("u!..."),
 * per https://learn.microsoft.com/graph/api/shares-get#encoding-sharing-urls
 */
export const encodeShareUrl = (url: string): string => {
  const base64 = Buffer.from(url, 'utf8').toString('base64');
  return `u!${base64.replace(/=+$/g, '').replace(/\//g, '_').replace(/\+/g, '-')}`;
};

/**
 * Fetches the metadata of a driveItem from a share ID.
 */
export async function fetchGraphShareItem(
  graphClient: { get: <T>(url: string) => Promise<T> },
  shareId: string
): Promise<any> {
  return graphClient.get<any>(`/shares/${shareId}/driveItem`);
}

/**
 * Lists children of a SharePoint/OneDrive folder driveItem.
 */
export async function listGraphShareFolderChildren(
  graphClient: { get: <T>(url: string) => Promise<T> },
  shareId: string
): Promise<any[]> {
  const res = await graphClient.get<{ value?: any[] }>(`/shares/${shareId}/driveItem/children`);
  return res.value || [];
}

/**
 * Fetches a file content stream from a SharePoint/OneDrive share ID or specific itemId.
 */
export async function getGraphShareFileStream(
  graphClient: { getStream: (url: string) => Promise<NodeJS.ReadableStream> },
  shareId: string,
  itemId?: string
): Promise<NodeJS.ReadableStream> {
  const url = itemId
    ? `/shares/${shareId}/items/${itemId}/content`
    : `/shares/${shareId}/driveItem/content`;
  return graphClient.getStream(url);
}
