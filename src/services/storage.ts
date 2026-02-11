import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import path from "path";
import fs from "fs";
import { promisify } from "util";
import multer from "multer";
import crypto from "crypto";

const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);

const awsEnabled = process.env.AWS_S3_ENABLED === "true";
const bucketName = process.env.AWS_S3_BUCKET_NAME || "";
const awsRegion = process.env.AWS_REGION || "eu-west-1";
const endpointUrl = process.env.AWS_ENDPOINT_URL;

let s3Client: S3Client | null = null;

function getS3Client(): S3Client | null {
  if (!awsEnabled || !bucketName) {
    console.log("S3 not enabled or bucket name missing");
    return null;
  }

  if (!s3Client) {
    try {
      const config: any = { region: awsRegion };

      if (endpointUrl) {
        config.endpoint = endpointUrl;
        config.forcePathStyle = true;
      }

      s3Client = new S3Client(config);
      console.log("S3 client initialized successfully");
    } catch (err) {
      console.error("Failed to initialize S3 client:", err);
      return null;
    }
  }
  return s3Client;
}

export const upload = multer({ storage: multer.memoryStorage() });

export async function uploadPdfFromRequest(
  file: Express.Multer.File | undefined,
): Promise<string | null> {
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
        }),
      );

      // Store just the S3 key, not the full URL
      return key;
    } catch (err) {
      console.error(
        "Failed to upload to S3, falling back to local storage",
        err,
      );
    }
  }

  // Local storage fallback
  const root = path.join(process.cwd(), "uploads", "pdfs");
  await mkdir(root, { recursive: true });
  const dest = path.join(root, filename);
  await writeFile(dest, file.buffer);
  return `/files/pdfs/${filename}`;
}

// New function to generate signed URLs
export async function getSignedPdfUrl(s3Key: string): Promise<string | null> {
  // If it's a local file path, return as-is
  if (s3Key.startsWith("/files/")) {
    return s3Key;
  }

  const client = getS3Client();
  if (!client) return null;

  try {
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: s3Key,
    });

    // Generate signed URL valid for 1 hour
    const signedUrl = await getSignedUrl(client, command, { expiresIn: 3600 });
    return signedUrl;
  } catch (err) {
    console.error("Failed to generate signed URL:", err);
    return null;
  }
}
