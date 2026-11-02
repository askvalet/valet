// Node's modules, for the few lines of server code that reach for them at import time. Nothing here runs in the demo's
// answers: pictures are plain files, and only the art list is read.
import art from '../art/art.json?raw';

const local = art.replace(/\/api\/image\/lab\?ref=cover-([0-9a-f]{12})/g, '/art/covers/$1.jpg');
export const existsSync = () => true, readFileSync = () => local, statSync = () => ({ size: 0 }), createReadStream = () => null, mkdirSync = () => {}, writeFileSync = () => {}, watch = () => {};
export const readFile = async () => '', writeFile = async () => {}, mkdir = async () => {}, rename = async () => {}, readdir = async () => [], stat = async () => ({}), rm = async () => {};
export const join = (...p: string[]) => p.join('/'), resolve = join, dirname = (p: string) => p.replace(/\/[^/]*$/, ''), basename = (p: string) => p.split('/').pop();
export const createServer = () => ({ listen() {} }), Readable = { toWeb: (s: unknown) => s };
export const randomBytes = () => new Uint8Array(16), createHash = () => ({ update() { return this; }, digest: () => '' });
export default {};
