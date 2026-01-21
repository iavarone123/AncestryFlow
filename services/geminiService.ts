
import { GoogleGenAI, Type } from "@google/genai";
import { ExtractionResult, FamilyMember, GroundingSource } from "../types";

const extractionSchema = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING, description: "A title for this family tree - MUST include the subject's full name." },
    description: { type: Type.STRING, description: "A short summary of the family history." },
    estateInfo: { type: Type.STRING, description: "ONLY populated for 'Death Record' searches. MUST be empty for Heirs/Ancestry searches." },
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

const sanitizeJson = (text: string) => {
  try {
    const cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
    return JSON.parse(cleaned);
  } catch (e) {
    console.error("JSON Parse Error:", e, text);
    return null;
  }
};

/**
 * Global Chat/Search helper with Google Search grounding.
 */
export const askGemini = async (question: string, context?: ExtractionResult | null): Promise<{ text: string, sources?: GroundingSource[] }> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  let systemInstruction = "You are an expert genealogist. ";
  if (context && context.members && context.members.length > 0) {
    systemInstruction += `The user is looking at a family tree with these people: ${context.members.map(m => m.name).join(", ")}. 
    If they ask for parents or relatives, search specifically for those individuals. 
    State the names clearly (e.g., 'The parents of X are Y and Z') so the user can easily integrate them into the flowchart.`;
  } else {
    systemInstruction += "Perform deep web research to answer genealogy questions with names, dates, and relationships.";
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: question,
      config: {
        systemInstruction: systemInstruction,
        tools: [{ googleSearch: {} }],
      },
    });

    const groundingSources = response.candidates?.[0]?.groundingMetadata?.groundingChunks
      ?.map((chunk: any) => chunk.web)
      .filter((web: any) => web && web.uri && web.title);

    return {
      text: response.text || "No records found for that request.",
      sources: groundingSources || []
    };
  } catch (error) {
    console.error("Chat error:", error);
    return { text: "Error connecting to research database. Please try a more specific name." };
  }
};

/**
 * Merges information from a chat response into the existing family tree.
 * userQuery is vital to know WHICH person the user was asking about.
 */
export const mergeChatInfo = async (currentData: ExtractionResult | null, chatText: string, userQuery: string): Promise<ExtractionResult> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const prompt = `Task: Update the current family tree by integrating new Research Findings.
     
     USER QUERY: "${userQuery}"
     RESEARCH FINDINGS: "${chatText}"
     ${currentData ? `CURRENT TREE MEMBERS: ${JSON.stringify(currentData.members.map(m => ({ id: m.id, name: m.name, parents: m.parents })))}` : "CURRENT TREE: Empty"}
     
     CRITICAL TARGETING RULE:
     1. IDENTIFY THE TARGET: Based on the USER QUERY, determine exactly WHICH person in the tree the user is asking about. For example, if the query is "Who were Prince Philip's parents?", the TARGET is "Prince Philip".
     2. ANCHOR THE NEW DATA: All parent/child information found in the RESEARCH FINDINGS must be linked to that specific TARGET node in the tree.
     
     STRUCTURAL LINKING RULES:
     - If findings name parents for the TARGET:
        - Create new member nodes for the parents.
        - UPDATE the existing TARGET person's 'parents' array to include the IDs of these new parent nodes.
     - If findings name children for the TARGET:
        - Create new member nodes for the children.
        - Set the 'parents' array of those new children to include the TARGET's ID.
     - ID INTEGRITY: You MUST preserve the 'id' of every person already present in the tree. Do not change them.
     - If the TARGET is not found in the tree (e.g., tree is empty), create the TARGET first, then the parents.
     
     Return the complete, unified family tree in valid JSON format.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: extractionSchema,
      },
    });

    const result = sanitizeJson(response.text || "{}") || { members: [] };
    return {
      ...result,
      sources: currentData?.sources || []
    } as ExtractionResult;
  } catch (error) {
    console.error("Merge error:", error);
    throw new Error("Failed to merge findings into the lineage structure.");
  }
};

/**
 * Initial extraction.
 */
export const extractFamilyData = async (
  content: string, 
  inputType: 'text' | 'image' | 'spreadsheet' = 'text',
  mimeType: string = "image/jpeg"
): Promise<ExtractionResult> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  let prompt = "";
  if (inputType === 'text') {
    prompt = `Research the family and immediate heirs of: "${content}". Use Google Search to find verified relatives.`;
  } else if (inputType === 'spreadsheet') {
    prompt = `Map this spreadsheet data to a family tree structure. Data: ${content}`;
  } else {
    prompt = `Analyze the document and extract family members, focus on names, dates, and clear parent-child links.`;
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: inputType !== 'image' ? prompt : [
        { text: prompt },
        { inlineData: { mimeType: mimeType, data: content.split(',')[1] } }
      ],
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: extractionSchema,
      },
    });

    const result = sanitizeJson(response.text || "{}") || { members: [] };
    if (result.members?.length > 0 && inputType === 'text') {
      const root = result.members[0];
      if (root.name.toLowerCase().includes("subject")) root.name = content;
    }
    
    result.estateInfo = "";
    const groundingSources = response.candidates?.[0]?.groundingMetadata?.groundingChunks
      ?.map((chunk: any) => chunk.web)
      .filter((web: any) => web && web.uri && web.title);

    return { ...result, sources: groundingSources || [] } as ExtractionResult;
  } catch (error) {
    console.error("Extraction error:", error);
    throw new Error(`Lineage extraction failed.`);
  }
};

export const researchDeathRecords = async (subject: string): Promise<ExtractionResult> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const prompt = `Research vital death records and obituaries for: "${subject}". Find heirs and probate details.`;
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: extractionSchema,
      },
    });
    const result = sanitizeJson(response.text || "{}") || { members: [] };
    const groundingSources = response.candidates?.[0]?.groundingMetadata?.groundingChunks
      ?.map((chunk: any) => chunk.web)
      .filter((web: any) => web && web.uri && web.title);
    return { ...result, sources: groundingSources || [] } as ExtractionResult;
  } catch (error) {
    throw new Error("Vital records search failed.");
  }
};

export const updateFamilyData = async (currentData: ExtractionResult, updateText: string): Promise<ExtractionResult> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const prompt = `Apply updates to this family tree based on: "${updateText}". Existing data: ${JSON.stringify(currentData)}`;
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: { responseMimeType: "application/json", responseSchema: extractionSchema },
    });
    return { ...(sanitizeJson(response.text || "{}") || { members: [] }), sources: currentData.sources };
  } catch (error) {
    throw new Error("Record update failed.");
  }
};

export const discoverExtendedFamily = async (members: FamilyMember[], direction: 'forward' | 'backward' = 'forward', targetId?: string): Promise<ExtractionResult> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const target = targetId ? members.find(m => m.id === targetId) : members[0];
  const prompt = `Perform extensive search for ${direction === 'forward' ? 'heirs' : 'ancestors'} of: ${target?.name}. Use Google Search.`;
  try {
    const response = await ai.models.generateContent({
      model: direction === 'backward' ? "gemini-3-pro-preview" : "gemini-3-flash-preview",
      contents: prompt,
      config: { tools: [{ googleSearch: {} }], responseMimeType: "application/json", responseSchema: extractionSchema },
    });
    const result = sanitizeJson(response.text || "{}") || { members: [] };
    const groundingSources = response.candidates?.[0]?.groundingMetadata?.groundingChunks
      ?.map((chunk: any) => chunk.web)
      .filter((web: any) => web && web.uri && web.title);
    return { ...result, sources: groundingSources || [] } as ExtractionResult;
  } catch (error) {
    throw new Error("Lineage expansion failed.");
  }
};
