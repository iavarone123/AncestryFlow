
export interface FamilyMember {
  id: string;
  name: string;
  birthYear?: string;
  deathYear?: string;
  gender?: 'male' | 'female' | 'other';
  relationship?: string; // e.g., "Great-Granddaughter", "Son", etc.
  vitalStatus?: 'living' | 'deceased' | 'unknown';
  notes?: string;
  parents?: string[]; // IDs of parents
  partners?: string[]; // IDs of spouses/partners
  status?: 'definitive' | 'probable' | 'possible'; // AI Confidence level
}

export interface FamilyData {
  members: FamilyMember[];
  relationships: FamilyRelationship[];
}

export interface FamilyRelationship {
  sourceId: string;
  targetId: string;
  type: 'parent-child' | 'partner';
}

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface ExtractionResult {
  members: FamilyMember[];
  title?: string;
  description?: string;
  sources?: GroundingSource[];
}
