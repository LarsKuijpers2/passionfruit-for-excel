import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import * as fs from "fs";

async function testClaudeVision() {
  // Use a PDF with allergen tables
  const pdfPath = "customers/Doehler Oosterhout/incoming/Version 7_Standard Questionnaire for Customers_Oosterhout (1).pdf";
  
  try {
    console.log("Reading PDF:", pdfPath);
    const pdfData = fs.readFileSync(pdfPath).toString("base64");
    console.log("PDF size:", (pdfData.length / 1024 / 1024).toFixed(2), "MB");
    
    const client = new BedrockRuntimeClient({ region: "eu-central-1" });
    
    const payload = {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 8000,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: pdfData },
            },
            {
              type: "text",
              text: `Find ANY allergen table in this document (may list allergens like Gluten, Wheat, Eggs, Milk, etc. with columns for "present in product", "on production line", etc.)

For the allergen table, extract EACH row with EACH column value separately:

Return JSON:
{
  "allergen_table": {
    "headers": ["Allergen", "Column2", "Column3", ...],
    "rows": [
      {"allergen": "Gluten", "col2": "No", "col3": "No", ...},
      {"allergen": "Wheat", "col2": "No", "col3": "Yes", ...}
    ]
  }
}

CRITICAL: Each column must have exactly ONE value (Yes/No/X/-). Never concatenate multiple column values.`,
            },
          ],
        },
      ],
    };
    
    const command = new InvokeModelCommand({
      modelId: "eu.anthropic.claude-sonnet-4-20250514-v1:0",
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify(payload),
    });
    
    const response = await client.send(command);
    const result = JSON.parse(new TextDecoder().decode(response.body));
    
    console.log("\n=== Claude Vision - Allergen Table Extraction ===\n");
    const text = result.content?.[0]?.text || JSON.stringify(result);
    console.log(text);
    
  } catch (err: any) {
    console.error("Error:", err.message || err);
  }
}

testClaudeVision();
