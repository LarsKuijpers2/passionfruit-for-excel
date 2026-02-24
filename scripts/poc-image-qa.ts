/**
 * POC: Image-based Q&A extraction with bounding boxes
 *
 * 1. Render PDF page to image
 * 2. Draw bounding boxes around paragraphs using sharp
 * 3. Send to Claude Vision to identify key-value pairs
 */

import { readFile, writeFile } from 'fs/promises';
import { execSync } from 'child_process';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import sharp from 'sharp';

const PDF_PATH = 'customers/beneo/incoming/Barry Callebaut US_Raw Material Questionnaire for SRM –  033079_2024Aug07_final signed_2024Nov27_DTE.pdf';
const STRUCTURE_PATH = 'customers/beneo/structure/Barry_Callebaut_US_Raw_Material_Questionnaire_for_SRM____033079_2024Aug07_final_signed_2024Nov27_DTE.json';

async function main() {
  console.log('Loading structure...');
  const structure = JSON.parse(await readFile(STRUCTURE_PATH, 'utf-8'));
  const paragraphs = structure.textContent?.paragraphs || [];
  const pages = structure.pages || [];

  // Get page 3 info
  const page3Info = pages.find((p: any) => p.pageNumber === 3);
  const pageWidth = page3Info?.width || 8.5;
  const pageHeight = page3Info?.height || 11;

  console.log(`Page 3 dimensions: ${pageWidth} x ${pageHeight} inches`);

  // Filter paragraphs for page 3
  const page3Paragraphs = paragraphs
    .filter((p: any) => p.pageNumber === 3)
    .sort((a: any, b: any) => (a.boundingBox?.[1] || 0) - (b.boundingBox?.[1] || 0));

  console.log(`Found ${page3Paragraphs.length} paragraphs on page 3`);

  // Build text list (no pre-classification - let Claude decide)
  const textList = page3Paragraphs.map((p: any, i: number) => {
    const y = p.boundingBox?.[1]?.toFixed(2) || '?';
    const x = p.boundingBox?.[0]?.toFixed(2) || '?';
    const content = p.content?.trim() || '';
    return `[${i}] x=${x}" y=${y}": "${content}"`;
  }).join('\n');

  console.log('\n=== Paragraphs with positions ===');
  console.log(textList);

  // Try to render PDF page using pdftoppm
  let pdfImageBuffer: Buffer | null = null;

  try {
    // Try different pdftoppm syntaxes
    try {
      execSync(`pdftoppm -f 3 -l 3 -r 150 -png "${PDF_PATH}" /tmp/barry_page`, { encoding: 'utf-8', stdio: 'pipe' });
    } catch {
      execSync(`pdftoppm "${PDF_PATH}" /tmp/barry_page -f 3 -l 3 -r 150 -png`, { encoding: 'utf-8', stdio: 'pipe' });
    }

    // Try different output file naming conventions
    for (const suffix of ['-03.png', '-3.png', '-003.png']) {
      try {
        pdfImageBuffer = await readFile('/tmp/barry_page' + suffix);
        console.log(`\nLoaded PDF image from /tmp/barry_page${suffix}`);
        break;
      } catch {}
    }
  } catch (e) {
    console.log('\npdftoppm not available, trying sips...');
  }

  if (!pdfImageBuffer) {
    // Create a simple placeholder image with just bounding boxes
    console.log('Creating placeholder image with bounding boxes...');

    const DPI = 150;
    const imgWidth = Math.round(pageWidth * DPI);
    const imgHeight = Math.round(pageHeight * DPI);

    // Create base image
    const baseImage = await sharp({
      create: {
        width: imgWidth,
        height: imgHeight,
        channels: 3,
        background: { r: 255, g: 255, b: 255 }
      }
    }).png().toBuffer();

    pdfImageBuffer = baseImage;
  }

  // Overlay bounding boxes on the image
  console.log('\nOverlaying bounding boxes...');

  const pdfImage = sharp(pdfImageBuffer);
  const metadata = await pdfImage.metadata();
  const imgWidth = metadata.width || 1275;
  const imgHeight = metadata.height || 1650;

  console.log(`Image size: ${imgWidth} x ${imgHeight}`);

  // Scale factors
  const scaleX = imgWidth / pageWidth;
  const scaleY = imgHeight / pageHeight;

  // Build SVG overlay with bounding boxes
  const svgParts: string[] = [];
  svgParts.push(`<svg width="${imgWidth}" height="${imgHeight}" xmlns="http://www.w3.org/2000/svg">`);

  for (let i = 0; i < page3Paragraphs.length; i++) {
    const p = page3Paragraphs[i];
    const bb = p.boundingBox;
    if (!bb || bb.length < 8) continue;

    // Bounding box: [x1,y1, x2,y2, x3,y3, x4,y4]
    const x1 = bb[0] * scaleX;
    const y1 = bb[1] * scaleY;
    const x2 = bb[2] * scaleX;
    const y3 = bb[5] * scaleY;

    const boxWidth = x2 - x1;
    const boxHeight = y3 - y1;

    // All same color - let Claude decide what's a key vs value
    const color = '#cc0000'; // red for all boxes

    svgParts.push(`<rect x="${x1}" y="${y1}" width="${boxWidth}" height="${boxHeight}" fill="none" stroke="${color}" stroke-width="3" opacity="0.8"/>`);
    svgParts.push(`<rect x="${x1}" y="${y1 - 18}" width="24" height="16" fill="${color}"/>`);
    svgParts.push(`<text x="${x1 + 3}" y="${y1 - 5}" font-size="12" font-weight="bold" fill="white">${i}</text>`);
  }

  svgParts.push('</svg>');
  const overlaySvg = svgParts.join('\n');

  // Composite overlay
  const annotatedImage = await pdfImage
    .composite([{
      input: Buffer.from(overlaySvg),
      top: 0,
      left: 0,
    }])
    .png()
    .toBuffer();

  await writeFile('/tmp/page3_annotated.png', annotatedImage);
  console.log('Saved annotated image to /tmp/page3_annotated.png');

  // Send to Claude Vision
  console.log('\nSending to Claude Vision...');

  const client = new BedrockRuntimeClient({ region: 'eu-central-1' });
  const imageBase64 = annotatedImage.toString('base64');

  const prompt = `This is page 3 of a PDF questionnaire. I've drawn red bounding boxes around all detected text paragraphs, each labeled with a number.

Here are the text contents with their box numbers and positions (x,y in inches):
${textList}

**Task**: Looking at the VISUAL LAYOUT in the image, identify key-value pairs (questions with their answers).

A key-value pair is:
- A LABEL/QUESTION (the key) paired with its ANSWER/VALUE
- They should be visually associated: horizontally adjacent, vertically stacked, or in a form field layout
- The value can be ANY text (not just Yes/No) - short answers, numbers, dates, selections, etc.

Consider:
1. Form field patterns: label on left, value on right
2. Table patterns: header above, value below
3. Checkbox/selection patterns: question followed by marked answer
4. Proximity: key and value should be close together

Return a JSON array of ALL key-value pairs you can identify:
[{"key_idx": N, "value_idx": M, "key": "label/question text", "value": "answer text", "confidence": 0.9, "visual_reason": "why paired"}]

Include any clear associations, not just Yes/No answers.`;


  const response = await client.send(new InvokeModelCommand({
    modelId: 'eu.anthropic.claude-sonnet-4-20250514-v1:0',
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: imageBase64,
            },
          },
          {
            type: 'text',
            text: prompt,
          },
        ],
      }],
    }),
    contentType: 'application/json',
  }));

  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  console.log('\n=== Claude Vision Response ===');
  console.log(responseBody.content[0].text);
}

main().catch(console.error);
