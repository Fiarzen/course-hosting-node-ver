import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import path from "path";
import fs from "fs";
import { promisify } from "util";
import { Request } from "express";
import multer from "multer";
import crypto from "crypto";

const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);

const awsEnabled = process.env.AWS_S3_ENABLED === "true";
const bucketName = process.env.AWS_S3_BUCKET_NAME || "";
const awsRegion = process.env.AWS_REGION || "eu-west-1";

let s3Client: S3Client | null = null;

function getS3Client(): S3Client | null {
  if (!awsEnabled || !bucketName) return null;
  if (!s3Client) {
    s3Client = new S3Client({ region: awsRegion });
  }
  return s3Client;
}

export const upload = multer({ storage: multer.memoryStorage() });

export async function uploadPdfFromRequest(file: Express.Multer.File | undefined): Promise<string | null> {
  if (!file) return null;

  const filename = `${crypto.randomUUID()}_${file.originalname}`;

  const client = getS3Client();
  if (client) {
    try {
      const key = `pdfs/${filename}`;
      await client.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: key,
          Body: file.buffer,
          ContentType: "application/pdf",
        })
      );
      return `https://${bucketName}.s3.${awsRegion}.amazonaws.com/${key}`;
    } catch (err) {
      console.error("Failed to upload to S3, falling back to local storage", err);
    }
  }

  // Local storage fallback under uploads/pdfs
  const root = path.join(process.cwd(), "uploads", "pdfs");
  await mkdir(root, { recursive: true });
  const dest = path.join(root, filename);
  await writeFile(dest, file.buffer);
  return `/files/pdfs/${filename}`;
}
