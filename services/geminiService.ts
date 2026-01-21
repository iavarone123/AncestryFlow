
import { GoogleGenAI, Type } from "@google/genai";
import { ExtractionResult, FamilyMember, GroundingSource } from "../types";

const extractionSchema = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING, description: "A title for this family tree - MUST include the subject's full name." },
    description: { type: Type.STRING, description: "A short summary of the family history." },
    estateInfo: { type: Type.STRING, description: "ONLY populated for 'Death Record' searches. Otherwise empty." },
    members: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING, description: "Unique short identifier." },
          name: { type: Type.STRING, description: "Full name of the person." },
          birthYear: { type: Type.STRING, description: "Birth year/date." },
          deathYear: { type: Type.STRING, description: "Death year/date." },
          gender: { type: Type.STRING, enum: ["male", "female", "other"] },
          relationship: { type: Type.STRING, description: "Relationship to the main subject." },
          vitalStatus: { type: Type.STRING, enum: ["living", "deceased", "unknown"] },
          notes: { type: Type.STRING, description: "Facts or occupations." },
          status: { type: Type.STRING, enum: ["definitive", "probable", "possible"] },
          parents: { 
            type: Type.ARRAY, 
            items: { type: Type.STRING },
            description: "IDs of parents." 
          },
          partners: { 
            type: Type.ARRAY, 
            items: { type: Type.STRING },
            description: "IDs of spouses." 
          }
        },
        required: ["id", "name"]
      }
    }
  },
  required: ["members"]
};

/**
 * Internal helper to perform a grounded search call.
 */
const performGroundedSearch = async (prompt: string): Promise<{ text: string, sources: GroundingSource[] }> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-3-pro-preview",
    contents: prompt,
    config: {
      tools: [{ googleSearch: {} }],
    },
  });

  const sources = response.candidates?.[0]?.groundingMetadata?.groundingChunks
    ?.map((chunk: any) => chunk.web)
    .filter((web: any) => web && web.uri && web.title) || [];

  return { text: response.text || "", sources };
};

/**
 * Internal helper to turn raw research text into structured family data.
 */
const extractLineageFromJson = async (researchText: string, context?: string): Promise<ExtractionResult> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const prompt = `Based on the following research material, extract a structured family tree. 
  CONTEXT: ${context || 'General Genealogy'}
  RESEARCH MATERIAL:
  ---
  ${researchText}
  ---
  Ensure all parent-child and partner relationships are explicitly linked using IDs.`;

  const response = await ai.models.generateContent({
    model: "gemini-3-pro-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: extractionSchema,
    },
  });

  try {
    const text = response.text || "{}";
    const cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
    return JSON.parse(cleaned) as ExtractionResult;
  } catch (e) {
    console.error("Failed to parse AI extraction:", e);
    return { members: [] };
  }
};

export const askGemini = async (question: string, context?: ExtractionResult | null): Promise<{ text: string, sources?: GroundingSource[] }> => {
  let fullPrompt = question;
  if (context && context.members.length > 0) {
    fullPrompt += ` (Context: Current tree includes ${context.members.map(m => m.name).join(", ")})`;
  }
  return performGroundedSearch(fullPrompt);
};

export const mergeChatInfo = async (currentData: ExtractionResult | null, chatText: string, userQuery: string): Promise<ExtractionResult> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const prompt = `Integrate these new findings into the existing family tree.
  USER QUERY: ${userQuery}
  FINDINGS: ${chatText}
  EXISTING DATA: ${JSON.stringify(currentData?.members || [])}
  Return the updated tree structure.`;

  const response = await ai.models.generateContent({
    model: "gemini-3-pro-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: extractionSchema,
    },
  });

  const result = JSON.parse(response.text || "{}");
  return { ...result, sources: currentData?.sources || [] };
};

export const extractFamilyData = async (
  content: string, 
  inputType: 'text' | 'image' | 'spreadsheet' = 'text',
  mimeType: string = "image/jpeg"
): Promise<ExtractionResult> => {
  if (inputType === 'text') {
    const research = await performGroundedSearch(`Research the family lineage and heirs of: ${content}`);
    const result = await extractLineageFromJson(research.text, `Lineage of ${content}`);
    return { ...result, sources: research.sources };
  }

  // Non-search paths (images/spreadsheets) can use JSON mode directly
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const prompt = inputType === 'spreadsheet' 
    ? `Map this spreadsheet data to a family tree: ${content}`
    : `Extract all family members and relationships from this document.`;

  const response = await ai.models.generateContent({
    model: "gemini-3-pro-preview",
    contents: inputType === 'spreadsheet' ? prompt : [
      { text: prompt },
      { inlineData: { mimeType, data: content.split(',')[1] } }
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: extractionSchema,
    },
  });

  return JSON.parse(response.text || "{}");
};

export const researchDeathRecords = async (subject: string): Promise<ExtractionResult> => {
  const research = await performGroundedSearch(`Research vital death records, obituaries, and probate details for: ${subject}`);
  const result = await extractLineageFromJson(research.text, `Death Records for ${subject}`);
  return { ...result, sources: research.sources };
};

export const discoverExtendedFamily = async (members: FamilyMember[], direction: 'forward' | 'backward' = 'forward', targetId?: string): Promise<ExtractionResult> => {
  const target = targetId ? members.find(m => m.id === targetId) : members[0];
  const research = await performGroundedSearch(`Find the ${direction === 'forward' ? 'children and heirs' : 'parents and ancestors'} of ${target?.name}.`);
  const result = await extractLineageFromJson(research.text, `Extended lineage of ${target?.name}`);
  return { ...result, sources: research.sources };
};

export const updateFamilyData = async (currentData: ExtractionResult, updateText: string): Promise<ExtractionResult> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-3-pro-preview",
    contents: `Apply these updates: "${updateText}" to this tree: ${JSON.stringify(currentData.members)}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: extractionSchema,
    },
  });
  return { ...JSON.parse(response.text || "{}"), sources: currentData.sources };
};
