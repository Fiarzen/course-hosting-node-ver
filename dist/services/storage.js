"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.upload = void 0;
exports.uploadPdfFromRequest = uploadPdfFromRequest;
const client_s3_1 = require("@aws-sdk/client-s3");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const util_1 = require("util");
const multer_1 = __importDefault(require("multer"));
const crypto_1 = __importDefault(require("crypto"));
const mkdir = (0, util_1.promisify)(fs_1.default.mkdir);
const writeFile = (0, util_1.promisify)(fs_1.default.writeFile);
const awsEnabled = process.env.AWS_S3_ENABLED === "true";
const bucketName = process.env.AWS_S3_BUCKET_NAME || "";
const awsRegion = process.env.AWS_REGION || "eu-west-1";
let s3Client = null;
function getS3Client() {
    if (!awsEnabled || !bucketName)
        return null;
    if (!s3Client) {
        s3Client = new client_s3_1.S3Client({ region: awsRegion });
    }
    return s3Client;
}
exports.upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage() });
async function uploadPdfFromRequest(file) {
    if (!file)
        return null;
    const filename = `${crypto_1.default.randomUUID()}_${file.originalname}`;
    const client = getS3Client();
    if (client) {
        try {
            const key = `pdfs/${filename}`;
            await client.send(new client_s3_1.PutObjectCommand({
                Bucket: bucketName,
                Key: key,
                Body: file.buffer,
                ContentType: "application/pdf",
            }));
            return `https://${bucketName}.s3.${awsRegion}.amazonaws.com/${key}`;
        }
        catch (err) {
            console.error("Failed to upload to S3, falling back to local storage", err);
        }
    }
    // Local storage fallback under uploads/pdfs
    const root = path_1.default.join(process.cwd(), "uploads", "pdfs");
    await mkdir(root, { recursive: true });
    const dest = path_1.default.join(root, filename);
    await writeFile(dest, file.buffer);
    return `/files/pdfs/${filename}`;
}
