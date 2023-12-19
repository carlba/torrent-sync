import fg from 'fast-glob';
import * as fs from 'fs';
import * as path from 'path';
import { pino } from 'pino';
import YAML from 'yaml';
import axios, { AxiosError, AxiosResponse } from 'axios';
import 'dotenv/config';

interface JacketResponse {
  Results: {
    FirstSeen: string;
    Tracker: string;
    TrackerId: string;
    TrackerType: string;
    BlackholeLink: string;
    Title: string;
    Guid: string;
    Link: string;
    Files: number;
  }[];
}

const panic = (message: string) => {
  throw new Error(message);
};

const apiKey = process.env.API_KEY || panic('API_KEY is not set');
const jackettBaseURL = process.env.JACKET_BASE_URL || panic('JACKET_BASE_URL is not set');
const globExpression = process.env.GLOB_EXPRESSION || panic('GLOB_EXPRESSION is not set');
const outputFilePath = process.env.OUTPUT_FILE_PATH || panic('OUTPUT_FILE_PATH is not set');

export const logger = pino({
  name: 'torrent-sync',
  level: 'debug',
});

logger.info({ apiKey, jackettBaseURL, globExpression, outputFilePath }, 'Starting Application');

const stream = fg.stream(globExpression);
const packs = new Set();

const searchTorrent = async (query: string): Promise<JacketResponse> => {
  const result = await axios
    .get<JacketResponse>(jackettBaseURL, { params: { apikey: apiKey, Query: query } })
    .then(response => response.data);
  return result;
};

const downloadFile = async (url: string, filePath: string) => {
  return await axios
    .get(url, { params: { apikey: apiKey }, responseType: 'stream' })
    .then(response => {
      response.data.pipe(fs.createWriteStream(filePath));

      return new Promise<string>((resolve, reject) => {
        response.data.on('end', (result: any) => resolve(result));
        response.data.on('error', (err: Error) => reject(err));
      });
    });
};

for await (const entry of stream) {
  const fullPath = entry;
  const releasePath = path.dirname(entry);
  const releaseName = path.basename(path.dirname(entry));
  const packPath = path.dirname(releasePath);
  const packName = path.basename(packPath);
  const packPathParentPath = path.dirname(packPath);

  if (packPath.match(/S[0-9][0-9]\./)) {
    if (!packs.has(packPath)) {
      packs.add(packPath);
      const jackettSearch = await searchTorrent(packName);
      const match = jackettSearch.Results.find(result => result.Title === packName);
      logger.info(
        {
          fullPath,
          releasePath,
          releaseName,
          packName,
          packPath,
          packPathParentPath,
          match: { files: match?.Files, title: match?.Title },
        },
        'Processing file entry'
      );
      if (match) {
        fs.appendFileSync(
          outputFilePath,
          YAML.stringify([{ path: packPathParentPath, link: match?.Link, packName, entry }])
        );
      }
    }
  }
}
