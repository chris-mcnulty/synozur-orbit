import mammoth from 'mammoth';
import { ObjectStorageService } from '../replit_integrations/object_storage';

export class DocumentExtractionService {
  private objectStorageService: ObjectStorageService;

  constructor() {
    this.objectStorageService = new ObjectStorageService();
  }

  async extractTextFromDocument(fileUrl: string, fileType: string): Promise<string> {
    try {
      const objectFile = await this.objectStorageService.getObjectEntityFile(fileUrl);
      const fileBuffer = await this.downloadFileAsBuffer(objectFile);

      switch (fileType.toLowerCase()) {
        case 'txt':
        case 'md':
          return fileBuffer.toString('utf-8');

        case 'pdf':
          return await this.extractPdfText(fileBuffer);

        case 'docx':
          return await this.extractDocxText(fileBuffer);

        case 'doc':
          return '[Note: .doc format text extraction not available. Please convert to .docx or PDF]';

        default:
          throw new Error(`Unsupported file type: ${fileType}`);
      }
    } catch (error) {
      console.error(`Error extracting text from ${fileUrl}:`, error);
      throw error;
    }
  }

  async extractFromPdf(buffer: Buffer): Promise<string> {
    try {
      // pdf-parse is a CommonJS module, use require for compatibility
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(buffer);
      return data.text;
    } catch (error) {
      console.error('PDF parsing error:', error);
      return '[Error: Could not extract text from PDF]';
    }
  }

  async extractFromDocx(buffer: Buffer): Promise<string> {
    try {
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    } catch (error) {
      console.error('DOCX parsing error:', error);
      return '[Error: Could not extract text from DOCX]';
    }
  }

  private async extractPdfText(buffer: Buffer): Promise<string> {
    return this.extractFromPdf(buffer);
  }

  private async extractDocxText(buffer: Buffer): Promise<string> {
    return this.extractFromDocx(buffer);
  }

  private async downloadFileAsBuffer(objectFile: any): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const stream = objectFile.createReadStream();

      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }

  chunkText(text: string, maxChunkSize: number = 4000): string[] {
    const chunks: string[] = [];
    const paragraphs = text.split(/\n\n+/);
    let currentChunk = '';

    for (const paragraph of paragraphs) {
      if (currentChunk.length + paragraph.length + 2 <= maxChunkSize) {
        currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
      } else {
        if (currentChunk) {
          chunks.push(currentChunk);
        }
        if (paragraph.length > maxChunkSize) {
          const sentences = paragraph.split(/(?<=[.!?])\s+/);
          currentChunk = '';
          for (const sentence of sentences) {
            if (currentChunk.length + sentence.length + 1 <= maxChunkSize) {
              currentChunk += (currentChunk ? ' ' : '') + sentence;
            } else {
              if (currentChunk) chunks.push(currentChunk);
              currentChunk = sentence.slice(0, maxChunkSize);
            }
          }
        } else {
          currentChunk = paragraph;
        }
      }
    }

    if (currentChunk) {
      chunks.push(currentChunk);
    }

    return chunks;
  }

  prepareGroundingContext(
    documents: Array<{ name: string; extractedText: string | null; scope: string }>,
    maxTokens: number = 8000
  ): string {
    if (!documents.length) return '';

    const avgCharsPerToken = 4;
    const maxChars = maxTokens * avgCharsPerToken;
    
    let context = '=== GROUNDING DOCUMENTS (Company Positioning & Strategy) ===\n\n';
    let remainingChars = maxChars - context.length;

    for (const doc of documents) {
      if (!doc.extractedText) continue;

      const docHeader = `--- Document: ${doc.name} (${doc.scope}) ---\n`;
      const docText = doc.extractedText.trim();
      
      if (docHeader.length + docText.length <= remainingChars) {
        context += docHeader + docText + '\n\n';
        remainingChars -= docHeader.length + docText.length + 2;
      } else if (remainingChars > docHeader.length + 200) {
        const truncatedText = docText.slice(0, remainingChars - docHeader.length - 50) + '... [truncated]';
        context += docHeader + truncatedText + '\n\n';
        break;
      } else {
        break;
      }
    }

    return context;
  }
}

export const documentExtractionService = new DocumentExtractionService();
