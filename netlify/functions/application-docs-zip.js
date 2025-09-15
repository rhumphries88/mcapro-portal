/*
 Netlify Function: application-docs-zip
 - Generates a ZIP file containing all documents for a given application_id
 - Source of files: Supabase table application_documents (uses file_url and file_name)
 - Usage: GET /.netlify/functions/application-docs-zip?applicationId=<uuid>
*/

import { createClient } from "@supabase/supabase-js";
import axios from "axios";
import JSZip from "jszip";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = SUPABASE_URL && SUPABASE_SERVICE_KEY ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY) : null;

function textResponse(statusCode, text, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      ...extraHeaders,
    },
    body: text,
  };
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return textResponse(200, "ok");
  if (event.httpMethod !== "GET") return textResponse(405, "Method Not Allowed");

  const applicationId = event.queryStringParameters?.applicationId || "";
  if (!applicationId) return textResponse(400, "Missing applicationId query parameter");

  try {
    if (!supabase) {
      return textResponse(500, "Supabase client is not configured");
    }

    const { data: docs, error } = await supabase
      .from("application_documents")
      .select("file_name,file_url")
      .eq("application_id", applicationId)
      .order("created_at", { ascending: false });
    if (error) return textResponse(400, `Failed to query application_documents: ${error.message}`);

    const files = (docs || []).filter(d => d && d.file_url);
    if (!files.length) return textResponse(404, "No documents found for this application");

    // Build ZIP using JSZip
    const zip = new JSZip();
    for (const f of files) {
      try {
        const res = await axios.get(f.file_url, { responseType: "arraybuffer" });
        const fname = f.file_name || new URL(f.file_url).pathname.split("/").pop() || "document.pdf";
        zip.file(fname, Buffer.from(res.data));
      } catch (e) {
        // Skip failed downloads, continue zipping others
      }
    }
    const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
    const base64 = buffer.toString("base64");

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="application-${applicationId}.zip"`,
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
      isBase64Encoded: true,
      body: base64,
    };
  } catch (err) {
    return textResponse(500, err?.message || "Unexpected server error");
  }
}

