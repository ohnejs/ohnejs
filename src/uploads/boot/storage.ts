import { createFSStorage } from '../storage/fs.ts';
import { useStorages } from '../storage/use-storages.ts';

useStorages().register('fs', createFSStorage);
