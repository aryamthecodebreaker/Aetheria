import { meshChunk } from './rendering/mesher';
import type { MeshJob, MeshResult } from './rendering/layout';

const context = self as unknown as {
  onmessage: (event: MessageEvent<MeshJob>) => void;
  postMessage: (message: MeshResult, transfer: Transferable[]) => void;
};
context.onmessage = ({ data }) => {
  const result = meshChunk(data);
  const transfer = [result.solid, result.water].flatMap(part =>
    [part.position, part.normal, part.uv, part.color, part.index].map(attribute => attribute.buffer as ArrayBuffer)
  );
  context.postMessage(result, transfer);
};
