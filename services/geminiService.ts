
import { GoogleGenAI, Type } from "@google/genai";
import { ExtractionResult, FamilyMember } from "../types";

const extractionSchema = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING, description: "A title for this family tree" },
    description: { type: Type.STRING, description: "A short summary of the family history" },
    members: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING, description: "Unique short identifier like 'john_doe'" },
          name: { type: Type.STRING, description: "Full name of the person" },
          birthYear: { type: Type.STRING, description: "Birth year or date if known" },
          deathYear: { type: Type.STRING, description: "Death year or date if known" },
          gender: { type: Type.STRING, enum: ["male", "female", "other"] },
          relationship: { type: Type.STRING, description: "Specific relationship to the main subject (e.g., 'Granddaughter', 'Son', 'Spouse')" },
          vitalStatus: { type: Type.STRING, enum: ["living", "deceased", "unknown"], description: "Whether the person is presumed living or deceased based on dates/context" },
          notes: { type: Type.STRING, description: "Interesting facts or occupations" },
          status: { type: Type.STRING, enum: ["definitive", "probable", "possible"], description: "Confidence level of this relation" },
          parents: { 
            type: Type.ARRAY, 
            items: { type: Type.STRING },
            description: "IDs of parents if mentioned" 
          },
          partners: { 
            type: Type.ARRAY, 
            items: { type: Type.STRING },
            description: "IDs of spouses or partners if mentioned" 
          }
        },
        required: ["id", "name"]
      }
    }
  },
  required: ["members"]
};

export const extractFamilyData = async (
  content: string, 
  inputType: 'text' | 'image' | 'spreadsheet' = 'text',
  mimeType: string = "image/jpeg"
): Promise<ExtractionResult> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  let prompt = "";
  if (inputType === 'text') {
    prompt = `Extract all family members and their relationships from the following text. 
       Identify parents, children, and spouses clearly. Ensure every person has a unique ID.
       For each person, determine if they are 'living' or 'deceased'. If birth year is more than 100 years ago and no death date, mark 'deceased'.
       Label 'relationship' specifically (e.g., 'Daughter of John', 'Great-Grandson').
       
       Text:
       ${content}`;
  } else if (inputType === 'spreadsheet') {
    prompt = `Extract a family tree from this spreadsheet data (CSV format). 
       Map rows into a structured family hierarchy.
       Determine 'vitalStatus' (living/deceased) based on years.
       Label 'relationship' specifically (e.g., 'Son', 'Wife').
       
       Data:
       ${content}`;
  } else {
    prompt = `Extract all family members from this ${mimeType} file.
       Identify relationships and lifespans. 
       Determine 'vitalStatus' (living/deceased).
       Label 'relationship' specifically.`;
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: inputType !== 'image' ? prompt : [
        { text: prompt },
        { inlineData: { mimeType: mimeType, data: content.split(',')[1] } }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: extractionSchema,
        thinkingConfig: { thinkingBudget: 8000 }
      },
    });

    const result = JSON.parse(response.text || "{}");
    return result as ExtractionResult;
  } catch (error) {
    console.error("Extraction error:", error);
    throw new Error(`Failed to extract family data.`);
  }
};

export const discoverExtendedFamily = async (
  currentMembers: FamilyMember[], 
  direction: 'forward' | 'backward' = 'forward',
  targetId?: string
): Promise<ExtractionResult> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const targetMember = targetId ? currentMembers.find(m => m.id === targetId) : null;
  const memberContext = currentMembers.map(m => `${m.name} (${m.birthYear}-${m.deathYear}, ${m.vitalStatus})`).join(", ");
  
  let researchFocus = "";
  if (direction === 'forward') {
    researchFocus = `Focus EXCLUSIVELY on moving FORWARD in time. 
       Find descendants (children, grandchildren) and contemporary spouses for: ${targetMember ? targetMember.name : 'the tree'}.
       DO NOT search for ancestors or parents.
       Ensure you specify 'vitalStatus' for new members.
       Provide specific 'relationship' labels relative to their parents.`;
  } else {
    researchFocus = `Focus EXCLUSIVELY on moving BACKWARD in time.
       Find parents, grandparents, and ancestors for: ${targetMember ? targetMember.name : 'the earliest known members'}.
       Bridge known records to historical archives.
       Ensure you specify 'vitalStatus' for new members.
       Provide specific 'relationship' labels (e.g., 'Father', 'Great-Grandmother').`;
  }

  const prompt = `Act as an expert genealogist. 
     Current context: ${memberContext}.
     
     TASK:
     ${researchFocus}
     
     1. Search online historical archives (census, obituaries, etc.).
     2. Assign confidence: 'definitive', 'probable', or 'possible'.
     3. Return updated JSON including new discoveries. 
     
     Keep existing IDs. New IDs must be unique strings.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: extractionSchema,
        thinkingConfig: { thinkingBudget: 15000 }
      },
    });

    const result = JSON.parse(response.text || "{}");
    const groundingSources = response.candidates?.[0]?.groundingMetadata?.groundingChunks
      ?.map((chunk: any) => chunk.web)
      .filter((web: any) => web && web.uri && web.title);

    return { 
      ...result, 
      sources: groundingSources 
    } as ExtractionResult;
  } catch (error) {
    console.error("Discovery error:", error);
    throw new Error("Research session failed.");
  }
};
