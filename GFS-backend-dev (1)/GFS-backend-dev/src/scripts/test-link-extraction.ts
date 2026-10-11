import { extractUrls, classifyProvider } from '../shared/utils/cloud-link';

const emailBodyHtml = `
  <p>Hello,</p>
  <p>Please check the following files:</p>
  <ul>
    <li>Here is the file: <a href="https://1drv.ms/b/c/3c850d465b04b65a/IQA59iuQ8uipSbYy9GCyyRmDAQ3E9t_BndKrj-hJAVPO0-Y?e=0d8jQy">OneDrive File Link</a></li>
    <li>Here is the folder: <a href="https://1drv.ms/f/c/3c850d465b04b65a/IgAe4T6NFUIZSK_lHsYsWRHdARg0sAwWCVPZg0LH-3iq8aM?e=fe4vLm">OneDrive Folder Link</a></li>
  </ul>
  <p>Thanks!</p>
`;

const emailBodyText = `
  Hello,
  Please check the following files:
  - File: https://1drv.ms/b/c/3c850d465b04b65a/IQA59iuQ8uipSbYy9GCyyRmDAQ3E9t_BndKrj-hJAVPO0-Y?e=0d8jQy
  - Folder: https://1drv.ms/f/c/3c850d465b04b65a/IgAe4T6NFUIZSK_lHsYsWRHdARg0sAwWCVPZg0LH-3iq8aM?e=fe4vLm
`;

console.log('--- Simulating Email Body Ingestion ---');
const extracted = extractUrls(emailBodyHtml, emailBodyText);

console.log(`Extracted ${extracted.length} links:\n`);
extracted.forEach((link, idx) => {
  const provider = classifyProvider(link.originalUrl);
  console.log(`Link #${idx + 1}:`);
  console.log(`  Original URL: ${link.originalUrl}`);
  console.log(`  Link Text:    ${link.linkText}`);
  console.log(`  Provider:     ${provider}`);
  console.log();
});
