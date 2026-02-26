
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function testGemini() {
    const apiKey = process.env.GEMINI_API_KEY;
    const modelName = process.env.HAI_GEMINI_CHAT_MODEL || 'gemini-2.0-flash';

    if (!apiKey) {
        console.error('No GEMINI_API_KEY found');
        return;
    }

    console.log(`Testing Gemini with model: ${modelName}`);
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: modelName });

    try {
        const result = await model.generateContent("Say 'Gemini is working' if you can read this.");
        console.log('Response:', result.response.text());
    } catch (error: any) {
        console.error('Gemini Test Failed:');
        console.error('Status:', error.status);
        console.error('Message:', error.message);
    }
}

testGemini();
