import { GoogleGenAI, createUserContent, createPartFromUri, Modality } from '@google/genai';

interface Message {
  text: string;
  isUser: boolean;
}

export const getAIResponse = async (
  message: string | undefined,
  messages: Message[],
  selectedModel: string,
  apiKey: string,
  onSendMessage: (message: string, isUser: boolean, imageUrl?: string) => void,
  onStreamEnd?: () => void,
  imageFile?: File
) => {
  if (!apiKey) {
    onSendMessage('API 키가 설정되지 않았습니다. 프로필 페이지에서 API 키를 설정해주세요.', false);
    onStreamEnd?.();
    return;
  }

  try {
    const contents = messages.map(msg => ({
      role: msg.isUser ? 'user' : 'model',
      parts: [{ text: msg.text }]
    }));


    const ai = new GoogleGenAI({ apiKey });

    if (imageFile) {
      // 이미지 업로드
      const uploaded = await ai.files.upload({ file: imageFile });
      
      if (!uploaded.uri || !uploaded.mimeType) {
        throw new Error('Uploaded file does not have a URI or MIME type.');
      }
      
      const response = await ai.models.generateContentStream({
        model: selectedModel,
        contents: [
          createUserContent([
            createPartFromUri(uploaded.uri, uploaded.mimeType),
            message ?? '',
          ]),
        ],
      });

      let fullResponse = '';
      for await (const chunk of response) {
        fullResponse += chunk.text;
        onSendMessage(fullResponse, false);
      }
      onStreamEnd?.();

    }
    else{
      
      contents.push({
        role: 'user',
        parts: [{ text: message ?? '' }]
      });
      if (selectedModel === 'gemini-2.0-flash-exp-image-generation') {
        const response = await ai.models.generateContent({
          model: selectedModel,
          contents: contents,
          config: {responseModalities: [Modality.TEXT, Modality.IMAGE]},
        });

        for (const part of response.candidates?.[0]?.content?.parts ?? []) {
          if (part.text) {
            onSendMessage(part.text, false);
          } else if (part.inlineData) {
            const imageData = part.inlineData.data;
            if (imageData) {
              const mimeType = part.inlineData.mimeType
              const dataUrl = `data:${mimeType};base64,${imageData}`;
              onSendMessage("", false, dataUrl);
            }
          }
        }
        onStreamEnd?.();
      }

      else{
        try {
          const response = await ai.models.generateContentStream({
            model: selectedModel,
            contents: contents,
            config: {
              tools: [{ googleSearch: {} }],
            },
          });

          let fullResponse = '';
          for await (const chunk of response) {
            if (chunk.text === undefined) {
              continue;
            }
            fullResponse += chunk.text;
            onSendMessage(fullResponse, false);
          }
          onStreamEnd?.();
        } catch (err) {
          try {
            const res = await fetch('/api/superagent', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ query: message ?? '', numResults: 5 }),
            });
            if (!res.ok) {
              throw new Error('Fallback search failed');
            }
            const data = await res.json();
            const { results = [], provider } = data || {} as any;
            const webContext = `Web results (provider: ${provider || 'unknown'}):\n` +
              (results as Array<any>).map((r: any, i: number) => `${i + 1}. ${r.title || ''}\n${r.url || ''}\n${r.snippet || ''}`).join('\n\n');

            const augmented = messages.map(msg => ({
              role: msg.isUser ? 'user' : 'model',
              parts: [{ text: msg.text }]
            }));
            augmented.push({
              role: 'user',
              parts: [{ text: `${message ?? ''}\n\nUse these web results to answer and cite sources as [1], [2], etc.:\n\n${webContext}` }]
            });

            const response2 = await ai.models.generateContentStream({
              model: selectedModel,
              contents: augmented,
            });

            let fullResponse2 = '';
            for await (const chunk of response2) {
              if (chunk.text === undefined) {
                continue;
              }
              fullResponse2 += chunk.text;
              onSendMessage(fullResponse2, false);
            }
            onStreamEnd?.();
          } catch (fallbackErr) {
            onSendMessage('검색 도구에 문제가 발생했습니다. 웹 검색 없이 답변을 제공합니다.', false);
            const fallbackContents = messages.map(msg => ({
              role: msg.isUser ? 'user' : 'model',
              parts: [{ text: msg.text }]
            }));
            fallbackContents.push({ role: 'user', parts: [{ text: message ?? '' }] });
            const response3 = await ai.models.generateContentStream({
              model: selectedModel,
              contents: fallbackContents,
            });
            let text3 = '';
            for await (const chunk of response3) {
              if (chunk.text === undefined) continue;
              text3 += chunk.text;
              onSendMessage(text3, false);
            }
            onStreamEnd?.();
          }
        }
      }
    }
  } catch (error) {
    console.error('Error:', error);
    if (error instanceof Error && error.message.includes('API key')) {
      onSendMessage('API 키가 올바르지 않습니다. 프로필 페이지에서 올바른 API 키를 설정해주세요.', false);
    } else {
      onSendMessage(`죄송합니다. 오류가 발생했습니다.\n${error}`, false);
    }
    onStreamEnd?.();
  }
}; 