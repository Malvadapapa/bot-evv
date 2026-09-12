import { MetaAIProvider } from '../ai/providers/meta-ai.provider.js';

async function main() {
  console.log('🧪 Probando MetaAIProvider con la personalidad de Mequetrefe...');
  const provider = new MetaAIProvider('http://localhost:8788', 45000);

  const testQuestion = 'Hola, ¿quién sos y cómo te llamas?';
  console.log(`💬 Pregunta: "${testQuestion}"`);

  try {
    const reply = await provider.generateReply(testQuestion, []);
    console.log('\n======================================================');
    console.log('🤖 RESPUESTA GENERADA POR META AI:');
    console.log('======================================================');
    console.log(reply);
    console.log('======================================================\n');
  } catch (err) {
    console.error('❌ Error:', err);
  }
}

main();
