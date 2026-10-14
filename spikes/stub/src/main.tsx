import { mountShell } from '../../shared/app-shell.tsx';
import { adapter } from './adapter.tsx';
import spike from '../spike.json';

mountShell({ ...adapter, spike });
