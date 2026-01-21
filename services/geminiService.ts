
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
 * Internal helper to perform a grounded search call with an automatic fallback.
 */
const performGroundedSearch = async (prompt: string): Promise<{ text: string, sources: GroundingSource[] }> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview", // Flash is faster and more reliable for production web apps
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    const sources = response.candidates?.[0]?.groundingMetadata?.groundingChunks
      ?.map((chunk: any) => chunk.web)
      .filter((web: any) => web && web.uri && web.title) || [];

    return { text: response.text || "", sources };
  } catch (err) {
    console.warn("Grounded search tool failed or restricted. Falling back to internal model knowledge...", err);
    // FALLBACK: Use the model's high-capacity internal knowledge if the Search tool is blocked
    const fallbackResponse = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt + " (Search for verifiable historical records and family links from your internal database.)",
    });
    return { text: fallbackResponse.text || "", sources: [] };
  }
};

/**
 * Internal helper to turn raw research text into structured family data.
 */
const extractLineageFromJson = async (researchText: string, context?: string): Promise<ExtractionResult> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const prompt = `Task: Extract a structured family tree JSON from the provided research text.
  CONTEXT: ${context || 'Genealogy Research'}
  
  RESEARCH TEXT:
  ---
  ${researchText}
  ---
  RULES:
  1. Ensure IDs are unique and consistent.
  2. Link parents and children accurately.
  3. Set vitalStatus if clear (living/deceased).`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: extractionSchema,
      },
    });

    const text = response.text || "{}";
    const cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
    return JSON.parse(cleaned) as ExtractionResult;
  } catch (e) {
    console.error("Structured extraction failed:", e);
    return { members: [] };
  }
};

export const askGemini = async (question: string, context?: ExtractionResult | null): Promise<{ text: string, sources?: GroundingSource[] }> => {
  let fullPrompt = question;
  if (context && context.members.length > 0) {
    fullPrompt += ` (Context: Current tree includes members like ${context.members.slice(0,5).map(m => m.name).join(", ")})`;
  }
  return performGroundedSearch(fullPrompt);
};

export const mergeChatInfo = async (currentData: ExtractionResult | null, chatText: string, userQuery: string): Promise<ExtractionResult> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const prompt = `Merge new information into the family tree.
  USER QUERY: ${userQuery}
  NEW FINDINGS: ${chatText}
  EXISTING DATA: ${JSON.stringify(currentData?.members || [])}
  Return the updated and unified JSON tree.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: extractionSchema,
      },
    });
    const result = JSON.parse(response.text || "{}");
    return { ...result, sources: currentData?.sources || [] };
  } catch (e) {
    return currentData || { members: [] };
  }
};

export const extractFamilyData = async (
  content: string, 
  inputType: 'text' | 'image' | 'spreadsheet' = 'text',
  mimeType: string = "image/jpeg"
): Promise<ExtractionResult> => {
  if (inputType === 'text') {
    const research = await performGroundedSearch(`Perform detailed genealogy research for the family of: ${content}`);
    const result = await extractLineageFromJson(research.text, `Lineage of ${content}`);
    return { ...result, sources: research.sources };
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const prompt = inputType === 'spreadsheet' 
    ? `Analyze this CSV/Spreadsheet data and convert it into a family tree structure: ${content}`
    : `Extract all family members, birth/death dates, and relationships from this document image or PDF.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
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
  } catch (error) {
    console.error("Document analysis failed:", error);
    throw new Error("Unable to analyze this file. Please ensure it's a clear document or image.");
  }
};

export const researchDeathRecords = async (subject: string): Promise<ExtractionResult> => {
  const research = await performGroundedSearch(`Research vital death records, obituaries, and probate archives for: ${subject}`);
  const result = await extractLineageFromJson(research.text, `Death Records for ${subject}`);
  return { ...result, sources: research.sources };
};

export const discoverExtendedFamily = async (members: FamilyMember[], direction: 'forward' | 'backward' = 'forward', targetId?: string): Promise<ExtractionResult> => {
  const target = targetId ? members.find(m => m.id === targetId) : members[0];
  const research = await performGroundedSearch(`Find the ${direction === 'forward' ? 'heirs and descendants' : 'parents and ancestors'} of: ${target?.name}`);
  const result = await extractLineageFromJson(research.text, `Extended lineage for ${target?.name}`);
  return { ...result, sources: research.sources };
};

export const updateFamilyData = async (currentData: ExtractionResult, updateText: string): Promise<ExtractionResult> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Apply these manual updates: "${updateText}" to this tree: ${JSON.stringify(currentData.members)}`,
      config: {
        responseMimeType: "application/json",
        responseSchema: extractionSchema,
      },
    });
    return { ...JSON.parse(response.text || "{}"), sources: currentData.sources };
  } catch (e) {
    return currentData;
  }
};
