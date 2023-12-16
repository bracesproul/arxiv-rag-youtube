import type { NextApiRequest, NextApiResponse } from "next";

export type ArxivPaperNote = {
  note: string;
  pageNumbers: number[];
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Array<ArxivPaperNote> | undefined>
) {
  const API_URL = "http://localhost:8080/take_notes";
  const data = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: req.body,
  }).then((res) => {
    if (res.ok) {
      return res.json();
    }
    return null;
  });
  if (data) {
    return res.status(200).json(data);
  }
  return res.status(400);
}
