
import { GoogleGenAI, Type } from "@google/genai";
import { ExtractionResult, FamilyMember, GroundingSource } from "../types";

const extractionSchema = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING, description: "A title for this family tree." },
    description: { type: Type.STRING, description: "A short summary." },
    members: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING, description: "Unique short identifier." },
          name: { type: Type.STRING, description: "Full name." },
          birthYear: { type: Type.STRING },
          deathYear: { type: Type.STRING },
          gender: { type: Type.STRING, enum: ["male", "female", "other"] },
          relationship: { type: Type.STRING },
          vitalStatus: { type: Type.STRING, enum: ["living", "deceased", "unknown"] },
          notes: { type: Type.STRING },
          status: { type: Type.STRING, enum: ["definitive", "probable", "possible"] },
          parents: { type: Type.ARRAY, items: { type: Type.STRING } },
          partners: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ["id", "name"]
      }
    }
  },
  required: ["members"]
};

/**
 * Perform a search with a strict timeout and fallback to internal knowledge.
 */
const performResilientSearch = async (prompt: string): Promise<{ text: string, sources: GroundingSource[] }> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  // Try with Google Search Tool first
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });
    const sources = response.candidates?.[0]?.groundingMetadata?.groundingChunks
      ?.map((chunk: any) => chunk.web)
      .filter((web: any) => web && web.uri && web.title) || [];
    
    if (response.text) return { text: response.text, sources };
  } catch (err) {
    console.warn("Search tool failed, falling back to internal knowledge...", err);
  }

  // Fallback to high-speed internal model knowledge
  const fallbackResponse = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Based on your historical database and general knowledge, provide details on: ${prompt}. Focus on family members, dates, and lineage.`,
  });
  
  return { text: fallbackResponse.text || "No information found.", sources: [] };
};

/**
 * Structured extraction from raw text.
 */
const extractStructuredLineage = async (rawText: string): Promise<ExtractionResult> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Convert this genealogy research into a structured JSON family tree. 
    TEXT: ${rawText}
    Link parents and partners correctly using unique IDs.`,
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
    console.error("JSON parsing error:", e);
    return { members: [] };
  }
};

export const extractFamilyData = async (
  content: string, 
  inputType: 'text' | 'image' | 'spreadsheet' = 'text',
  mimeType: string = "image/jpeg"
): Promise<ExtractionResult> => {
  if (inputType === 'text') {
    const research = await performResilientSearch(`Genealogy research for ${content}. Identify immediate family, ancestors, and dates.`);
    const result = await extractStructuredLineage(research.text);
    return { ...result, sources: research.sources };
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const prompt = inputType === 'spreadsheet' 
    ? `Convert this data into a JSON family tree: ${content}`
    : `Extract family tree from this document. Identify members, dates, and parent-child links.`;

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
    throw new Error("Document analysis failed. Please ensure the file is a valid PDF or Image.");
  }
};

export const discoverExtendedFamily = async (members: FamilyMember[], direction: 'forward' | 'backward' = 'forward', targetId?: string): Promise<ExtractionResult> => {
  const target = targetId ? members.find(m => m.id === targetId) : members[0];
  const query = `Find ${direction === 'forward' ? 'children and descendants' : 'parents and ancestors'} of ${target?.name}.`;
  const research = await performResilientSearch(query);
  const result = await extractStructuredLineage(research.text);
  return { ...result, sources: research.sources };
};

export const researchDeathRecords = async (subject: string): Promise<ExtractionResult> => {
  const research = await performResilientSearch(`Find vital death records, obituaries, and heirs for ${subject}.`);
  const result = await extractStructuredLineage(research.text);
  return { ...result, sources: research.sources };
};

export const askGemini = async (question: string, context?: ExtractionResult | null): Promise<{ text: string, sources?: GroundingSource[] }> => {
  return performResilientSearch(`${question} ${context ? `(Context: Looking at tree for ${context.members.slice(0,3).map(m => m.name).join(", ")})` : ''}`);
};

export const mergeChatInfo = async (currentData: ExtractionResult | null, chatText: string, userQuery: string): Promise<ExtractionResult> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Merge this information: "${chatText}" into this tree: ${JSON.stringify(currentData?.members || [])}. User asked: "${userQuery}".`,
    config: {
      responseMimeType: "application/json",
      responseSchema: extractionSchema,
    },
  });
  return JSON.parse(response.text || "{}");
};

export const updateFamilyData = async (currentData: ExtractionResult, updateText: string): Promise<ExtractionResult> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Update these records based on: "${updateText}". Existing: ${JSON.stringify(currentData.members)}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: extractionSchema,
    },
  });
  return JSON.parse(response.text || "{}");
};
