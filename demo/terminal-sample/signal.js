const samples = [0.2, 0.8, -0.4, 0.5, 1.0];
const average = samples.reduce((sum, x) => sum + x, 0) / samples.length;
console.log(`Loaded ${samples.length} samples`);
console.log(`Mean amplitude: ${average.toFixed(2)}`);
console.log(`Peak amplitude: ${Math.max(...samples).toFixed(2)}`);
