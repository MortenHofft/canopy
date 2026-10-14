import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { spikeConfig } from '../shared/vite.base.mjs';

export default defineConfig(spikeConfig({ root: __dirname, plugins: [react()] }));
