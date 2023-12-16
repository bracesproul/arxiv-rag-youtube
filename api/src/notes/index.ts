import { Document } from "langchain/document";
import { ChatOpenAI } from "langchain/chat_models/openai";
import { formatDocumentsAsString } from "langchain/util/document";
import {
  ArxivPaperNote,
  NOTES_TOOL_SCHEMA,
  NOTE_PROMPT,
  outputParser,
} from "notes/prompt.js";
import { SupabaseDatabase } from "database.js";
import { writeFile, unlink } from "fs/promises";
import { UnstructuredLoader } from "langchain/document_loaders/fs/unstructured";
import axios from "axios";
import { PDFDocument } from "pdf-lib";

async function loadPdfFromUrl(url: string): Promise<Buffer> {
  const response = await axios({
    method: "GET",
    url,
    responseType: "arraybuffer",
  });
  return response.data;
}

async function deletePagesFromPdf(
  pdf: Buffer,
  pagesToDelete: number[]
): Promise<Buffer> {
  const pdfDoc = await PDFDocument.load(pdf);
  let numToOffsetBy = 1;
  for (const pageNumber of pagesToDelete) {
    pdfDoc.removePage(pageNumber - numToOffsetBy);
    numToOffsetBy += 1;
  }
  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

async function generateNotes(
  documents: Array<Document>
): Promise<Array<ArxivPaperNote>> {
  const documentsAsString = formatDocumentsAsString(documents);
  const model = new ChatOpenAI({
    modelName: "gpt-4-1106-preview",
    temperature: 0,
  });
  const modelWithTools = model.bind({
    tools: [NOTES_TOOL_SCHEMA],
    tool_choice: "auto",
  });
  const chain = NOTE_PROMPT.pipe(modelWithTools).pipe(outputParser);
  const response = await chain.invoke({
    paper: documentsAsString,
  });
  return response;
}

async function convertPdfToDocuments(pdf: Buffer): Promise<Array<Document>> {
  if (!process.env.UNSTRUCTURED_API_KEY) {
    throw new Error("Missing UNSTRUCTURED_API_KEY");
  }
  const randomName = Math.random().toString(36).substring(7);
  const pdfPath = `pdfs/${randomName}.pdf`;
  await writeFile(pdfPath, pdf, "binary");
  const loader = new UnstructuredLoader(pdfPath, {
    apiKey: process.env.UNSTRUCTURED_API_KEY,
    strategy: "hi_res",
  });
  const docs = await loader.load();
  /** Delete the temporary PDF file. */
  await unlink(pdfPath);
  return docs;
}

export async function takeNotes(
  paperUrl: string,
  name: string,
  pagesToDelete?: number[]
): Promise<ArxivPaperNote[]> {
  const database = await SupabaseDatabase.fromExistingIndex();
  const existingPaper = await database.getPaper(paperUrl);
  if (existingPaper) {
    return existingPaper.notes as Array<ArxivPaperNote>;
  }

  let pdfAsBuffer = await loadPdfFromUrl(paperUrl);
  if (pagesToDelete && pagesToDelete.length > 0) {
    pdfAsBuffer = await deletePagesFromPdf(pdfAsBuffer, pagesToDelete);
  }
  const documents = await convertPdfToDocuments(pdfAsBuffer);
  const notes = await generateNotes(documents);
  const newDocs: Array<Document> = documents.map((doc) => ({
    ...doc,
    metadata: {
      ...doc.metadata,
      url: paperUrl,
    },
  }));
  await Promise.all([
    database.addPaper({
      paper: formatDocumentsAsString(newDocs),
      url: paperUrl,
      notes,
      name,
    }),
    database.vectorStore.addDocuments(newDocs),
  ]);
  return notes;
}
