import React, { useState, useContext } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { AppContext } from '../context/AppContext';
import { Header } from '../components/Header';
import { apiService } from '../api/apiService';

export const ChatbotScreen = () => {
  const { userId, stressState, setCurrentScreen } = useContext(AppContext);

  const [messages, setMessages] = useState([
    {
      id: 1,
      sender: 'ai',
      text: `Hello! I am your CAPS AI Relaxation Guide. I see your current stress level is ${stressState.toUpperCase()}. How can I support you right now?`
    }
  ]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSend = async () => {
    if (!inputText.trim()) return;

    const userMsg = { id: Date.now(), sender: 'user', text: inputText };
    setMessages((prev) => [...prev, userMsg]);
    const userQuery = inputText;
    setInputText('');
    setLoading(true);

    try {
      const res = await apiService.sendChatMessage(userId, userQuery, stressState);
      const aiMsg = {
        id: Date.now() + 1,
        sender: 'ai',
        text: res.reply,
        suggestedAction: res.suggested_action
      };
      setMessages((prev) => [...prev, aiMsg]);
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { id: Date.now() + 1, sender: 'ai', text: "I'm right here with you. Take a slow, comforting breath." }
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Header title="AI Relaxation Counseling" showBack onBack={() => setCurrentScreen('Dashboard')} />

      <ScrollView contentContainerStyle={styles.chatList}>
        {messages.map((m) => (
          <View
            key={m.id}
            style={[
              styles.msgBubble,
              m.sender === 'user' ? styles.userBubble : styles.aiBubble
            ]}
          >
            <Text style={m.sender === 'user' ? styles.userTxt : styles.aiTxt}>
              {m.text}
            </Text>
            {m.suggestedAction && (
              <TouchableOpacity
                style={styles.actionTagBtn}
                onPress={() => setCurrentScreen('Dashboard')}
              >
                <Text style={styles.actionTagTxt}>🚀 Launch Suggested Exercise</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}

        {loading && (
          <View style={[styles.msgBubble, styles.aiBubble]}>
            <ActivityIndicator size="small" color="#38BDF8" />
          </View>
        )}
      </ScrollView>

      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          value={inputText}
          onChangeText={setInputText}
          placeholder="Talk to your relaxation guide..."
          placeholderTextColor="#64748B"
        />
        <TouchableOpacity style={styles.sendBtn} onPress={handleSend}>
          <Text style={styles.sendBtnTxt}>Send</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A'
  },
  chatList: {
    padding: 16,
    gap: 12
  },
  msgBubble: {
    maxWidth: '80%',
    padding: 14,
    borderRadius: 16
  },
  userBubble: {
    backgroundColor: '#38BDF8',
    alignSelf: 'flex-end',
    borderBottomRightRadius: 2
  },
  aiBubble: {
    backgroundColor: '#1E293B',
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 2,
    borderWidth: 1,
    borderColor: '#334155'
  },
  userTxt: {
    color: '#0F172A',
    fontWeight: '600',
    fontSize: 14
  },
  aiTxt: {
    color: '#F8FAFC',
    fontSize: 14,
    lineHeight: 20
  },
  actionTagBtn: {
    marginTop: 8,
    backgroundColor: '#38BDF8',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignSelf: 'flex-start'
  },
  actionTagTxt: {
    color: '#0F172A',
    fontWeight: '800',
    fontSize: 11
  },
  inputBar: {
    flexDirection: 'row',
    padding: 12,
    backgroundColor: '#1E293B',
    borderTopWidth: 1,
    borderTopColor: '#334155',
    gap: 8
  },
  input: {
    flex: 1,
    backgroundColor: '#0F172A',
    borderRadius: 20,
    paddingHorizontal: 16,
    color: '#F8FAFC',
    fontSize: 14
  },
  sendBtn: {
    backgroundColor: '#38BDF8',
    paddingHorizontal: 20,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center'
  },
  sendBtnTxt: {
    color: '#0F172A',
    fontWeight: '800',
    fontSize: 14
  }
});
