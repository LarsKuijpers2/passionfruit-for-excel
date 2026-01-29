/**
 * Types for Passionfruit Excel integration
 */

export interface CellData {
  address: string;
  value: string | number | boolean | Date | null;
  formula?: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'formula' | 'empty';
  style?: CellStyle;
}

export interface CellStyle {
  fill?: string;
  font?: {
    bold?: boolean;
    italic?: boolean;
    color?: string;
    size?: number;
  };
  border?: boolean;
  alignment?: 'left' | 'center' | 'right';
}

export interface SheetData {
  name: string;
  cells: Map<string, CellData>;
  dimensions: {
    startRow: number;
    endRow: number;
    startCol: number;
    endCol: number;
  };
  mergedCells: string[];
}

export interface WorkbookData {
  filename: string;
  sheets: SheetData[];
  activeSheet: string;
}

export interface ExcelModification {
  sheet: string;
  cell: string;
  value: string | number | boolean | Date;
  previousValue?: string | number | boolean | Date | null;
}

export interface AnalysisResult {
  answer: string;
  citations: CellCitation[];
  modifications?: ExcelModification[];
}

export interface CellCitation {
  sheet: string;
  cell: string;
  value: string | number | boolean | Date | null;
  context: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface PassfruitConfig {
  apiKey: string;
  model?: string;
  maxTokens?: number;
}

export interface ClaudeSkillResponse {
  content: Array<{
    type: string;
    text?: string;
    file_id?: string;
  }>;
  stop_reason: string;
  container?: {
    id: string;
  };
}
