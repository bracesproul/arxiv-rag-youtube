import { Document } from "langchain/document";
import { SupabaseClient, createClient } from "@supabase/supabase-js";
import { SupabaseVectorStore } from "langchain/vectorstores/supabase";
import { OpenAIEmbeddings } from "langchain/embeddings/openai";
import { Database } from "generated/db.js";
import { ArxivPaperNote } from "notes/prompt.js";

export const ARXIV_PAPERS_TABLE = "arxiv_papers";
export const ARXIV_EMBEDDINGS_TABLE = "arxiv_embeddings";
export const ARXIV_QA_TABLE = "arxiv_question_answering";

export class SupabaseDatabase {
  vectorStore: SupabaseVectorStore;

  client: SupabaseClient<Database, "public", any>;

  constructor(
    vectorStore: SupabaseVectorStore,
    client: SupabaseClient<Database, "public", any>
  ) {
    this.vectorStore = vectorStore;
    this.client = client;
  }

  static async fromExistingIndex(): Promise<SupabaseDatabase> {
    const privateKey = process.env.SUPABASE_PRIVATE_KEY;
    if (!privateKey) throw new Error(`Missing SUPABASE_PRIVATE_KEY`);

    const url = process.env.SUPABASE_URL;
    if (!url) throw new Error(`Missing SUPABASE_URL`);

    const client = createClient<Database>(url, privateKey);

    const vectorStore = await SupabaseVectorStore.fromExistingIndex(
      new OpenAIEmbeddings(),
      {
        client,
        tableName: ARXIV_EMBEDDINGS_TABLE,
        queryName: "match_documents",
      }
    );

    return new this(vectorStore, client);
  }

  static async fromDocuments(docs: Document[]): Promise<SupabaseDatabase> {
    const privateKey = process.env.SUPABASE_PRIVATE_KEY;
    if (!privateKey) throw new Error(`Missing SUPABASE_PRIVATE_KEY`);

    const url = process.env.SUPABASE_URL;
    if (!url) throw new Error(`Missing SUPABASE_URL`);

    const client = createClient<Database>(url, privateKey);

    const vectorStore = await SupabaseVectorStore.fromDocuments(
      docs,
      new OpenAIEmbeddings(),
      {
        client,
        tableName: ARXIV_EMBEDDINGS_TABLE,
        queryName: "match_documents",
      }
    );

    return new this(vectorStore, client);
  }

  async addPaper({
    paper,
    url,
    notes,
    name,
  }: {
    paper: string;
    url: string;
    notes: Array<ArxivPaperNote>;
    name: string;
  }): Promise<void> {
    const { error } = await this.client.from(ARXIV_PAPERS_TABLE).insert([
      {
        paper,
        arxiv_url: url,
        notes,
        name,
      },
    ]);
    if (error) {
      throw new Error(
        "Error adding paper to database" + JSON.stringify(error, null, 2)
      );
    }
  }

  async getPaper(
    url: string
  ): Promise<Database["public"]["Tables"]["arxiv_papers"]["Row"] | null> {
    const { data, error } = await this.client
      .from(ARXIV_PAPERS_TABLE)
      .select()
      .eq("arxiv_url", url);

    if (error || !data) {
      console.error("Error getting paper from database");
      return null;
    }
    return data[0];
  }

  async saveQa(
    question: string,
    answer: string,
    context: string,
    followupQuestions: string[]
  ) {
    const { error } = await this.client.from(ARXIV_QA_TABLE).insert({
      question,
      answer,
      context,
      followup_questions: followupQuestions,
    });
    if (error) {
      console.error("Error saving QA to database");
      throw error;
    }
  }
}
