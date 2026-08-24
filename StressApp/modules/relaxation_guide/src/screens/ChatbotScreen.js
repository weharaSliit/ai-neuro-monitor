import React, { useState, useContext, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput,
  TouchableOpacity, ActivityIndicator, Animated, Easing, KeyboardAvoidingView, Platform
} from 'react-native';
import { AppContext } from '../context/AppContext';
import { ThemeContext } from '../context/ThemeContext';
import { Header } from '../components/Header';
import { apiService } from '../api/apiService';

const SUGGESTIONS = [
  "I feel anxious 😟",
  "Start a breathing session 🌬️",
  "Help me relax 🧘",
  "Reduce my stress ❤️‍🩹",
];

/* Typing indicator: 3 bouncing dots */
const TypingIndicator = ({ theme }) => {
  const dots = [useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current];

  useEffect(() => {
    dots.forEach((d, i) => {
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 160),
          Animated.timing(d, { toValue: -8, duration: 320, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(d, { toValue: 0, duration: 320, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.delay(320),
        ])
      ).start();
    });
  }, []);

  return (
    <View style={[styles.msgBubble, styles.aiBubble, { backgroundColor: theme.bgSecondary, borderColor: theme.border, flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 14 }]}>
      {dots.map((d, i) => (
        <Animated.View key={i} style={[styles.typingDot, { backgroundColor: theme.accent, transform: [{ translateY: d }] }]} />
      ))}
    </View>
  );
};

/* Animated message bubble */
const MessageBubble = ({ message, theme, setCurrentScreen }) => {
  const slideAnim = useRef(new Animated.Value(message.sender === 'user' ? 20 : -20)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacityAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, tension: 80, friction: 10, useNativeDriver: true }),
    ]).start();
  }, []);

  const isUser = message.sender === 'user';

  return (
    <Animated.View style={[{ opacity: opacityAnim, transform: [{ translateX: slideAnim }] }, isUser ? { alignSelf: 'flex-end' } : { alignSelf: 'flex-start' }]}>
      {!isUser && (
        <View style={styles.aiRow}>
          <View style={[styles.aiAvatar, { backgroundColor: theme.accent + '20', borderColor: theme.accent }]}>
            <Text style={styles.aiAvatarIcon}>🤖</Text>
          </View>
          <View style={[styles.msgBubble, styles.aiBubble, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
            <Text style={[styles.aiTxt, { color: theme.textPrimary }]}>{message.text}</Text>
            {message.suggestedAction && (
              <TouchableOpacity
                style={[styles.actionTagBtn, { backgroundColor: theme.accent + '20', borderColor: theme.accent }]}
                onPress={() => setCurrentScreen('Dashboard')}
              >
                <Text style={[styles.actionTagTxt, { color: theme.accent }]}>🚀  Launch Suggested Exercise</Text>
              </TouchableOpacity>
            )}
            <Text style={[styles.timestamp, { color: theme.textMuted }]}>
              {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>
          </View>
        </View>
      )}
      {isUser && (
        <View style={[styles.msgBubble, styles.userBubble, { backgroundColor: theme.accent }]}>
          <Text style={[styles.userTxt, { color: theme.accentText }]}>{message.text}</Text>
          <Text style={[styles.timestamp, { color: theme.accentText + '99' }]}>
            {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>
      )}
    </Animated.View>
  );
};

export const ChatbotScreen = () => {
  const { userId, stressState, setCurrentScreen } = useContext(AppContext);
  const { theme } = useContext(ThemeContext);
  const scrollRef = useRef(null);

  const [messages, setMessages] = useState([
    {
      id: 1,
      sender: 'ai',
      text: `Hello! I'm your CAPS AI Relaxation Guide 🌿\n\nYour current stress level is ${stressState.toUpperCase()}. I'm here to support you. How are you feeling right now?`
    }
  ]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);

  const borderAnim = useRef(new Animated.Value(0)).current;

  const onFocus = () => {
    setFocused(true);
    Animated.timing(borderAnim, { toValue: 1, duration: 200, useNativeDriver: false }).start();
  };
  const onBlur = () => {
    setFocused(false);
    Animated.timing(borderAnim, { toValue: 0, duration: 200, useNativeDriver: false }).start();
  };
  const borderColor = borderAnim.interpolate({ inputRange: [0, 1], outputRange: [theme.border, theme.accent] });

  const sendMessage = async (text) => {
    const msgText = text || inputText;
    if (!msgText.trim()) return;

    const userMsg = { id: Date.now(), sender: 'user', text: msgText };
    setMessages(prev => [...prev, userMsg]);
    setInputText('');
    setLoading(true);

    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);

    try {
      const res = await apiService.sendChatMessage(userId, msgText, stressState);
      const aiMsg = { id: Date.now() + 1, sender: 'ai', text: res.reply, suggestedAction: res.suggested_action };
      setMessages(prev => [...prev, aiMsg]);
    } catch (e) {
      setMessages(prev => [...prev, { id: Date.now() + 1, sender: 'ai', text: "I'm right here with you. Take a slow, comforting breath. 🌬️" }]);
    } finally {
      setLoading(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150);
    }
  };

  const stressColor = stressState === 'stress' ? '#EF4444' : stressState === 'pre-stress' ? '#F59E0B' : '#10B981';

  return (
    <View style={[styles.container, { backgroundColor: theme.bgPrimary }]}>
      {/* Custom header with AI avatar */}
      <View style={[styles.chatHeader, { backgroundColor: theme.bgSecondary, borderBottomColor: theme.border }]}>
        <TouchableOpacity onPress={() => setCurrentScreen('Dashboard')} style={styles.backBtn}>
          <Text style={[styles.backTxt, { color: theme.accent }]}>‹</Text>
        </TouchableOpacity>
        <View style={[styles.headerAvatar, { backgroundColor: theme.accent + '20', borderColor: theme.accent }]}>
          <Text style={styles.headerAvatarIcon}>🤖</Text>
        </View>
        <View style={styles.headerInfo}>
          <Text style={[styles.headerTitle, { color: theme.textPrimary }]}>AI Relaxation Guide</Text>
          <View style={styles.headerStatus}>
            <View style={[styles.statusDot, { backgroundColor: '#10B981' }]} />
            <Text style={[styles.headerSub, { color: theme.textMuted }]}>Always here for you</Text>
          </View>
        </View>
        <View style={[styles.stressChip, { backgroundColor: stressColor + '20', borderColor: stressColor }]}>
          <Text style={[styles.stressChipTxt, { color: stressColor }]}>{stressState.toUpperCase()}</Text>
        </View>
      </View>

      {/* Suggestion chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[styles.suggestionsRow, { borderBottomColor: theme.border }]} contentContainerStyle={{ paddingHorizontal: 14, gap: 8 }}>
        {SUGGESTIONS.map((s, i) => (
          <TouchableOpacity
            key={i}
            style={[styles.suggestionChip, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}
            onPress={() => sendMessage(s)}
            activeOpacity={0.75}
          >
            <Text style={[styles.suggestionTxt, { color: theme.textSecondary }]}>{s}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.chatList}
          showsVerticalScrollIndicator={false}
        >
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} theme={theme} setCurrentScreen={setCurrentScreen} />
          ))}
          {loading && <TypingIndicator theme={theme} />}
        </ScrollView>

        <Animated.View style={[styles.inputBar, { backgroundColor: theme.bgSecondary, borderTopColor: theme.border, borderColor }]}>
          <TextInput
            style={[styles.input, { color: theme.textPrimary, backgroundColor: theme.bgPrimary }]}
            value={inputText}
            onChangeText={setInputText}
            placeholder="Talk to your relaxation guide..."
            placeholderTextColor={theme.textMuted}
            onFocus={onFocus}
            onBlur={onBlur}
            onSubmitEditing={() => sendMessage()}
            returnKeyType="send"
          />
          <TouchableOpacity
            style={[styles.sendBtn, { backgroundColor: inputText.trim() ? theme.accent : theme.border }]}
            onPress={() => sendMessage()}
            activeOpacity={0.8}
          >
            <Text style={[styles.sendBtnTxt, { color: inputText.trim() ? theme.accentText : theme.textMuted }]}>↑</Text>
          </TouchableOpacity>
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  chatHeader: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14,
    paddingTop: 12, paddingBottom: 12, borderBottomWidth: 1, gap: 10,
  },
  backBtn: { paddingRight: 4 },
  backTxt: { fontSize: 32, fontWeight: '300', lineHeight: 36 },
  headerAvatar: {
    width: 42, height: 42, borderRadius: 21,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1.5,
  },
  headerAvatarIcon: { fontSize: 20 },
  headerInfo: { flex: 1 },
  headerTitle: { fontSize: 15, fontWeight: '800' },
  headerStatus: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  statusDot: { width: 7, height: 7, borderRadius: 3.5 },
  headerSub: { fontSize: 11, fontWeight: '600' },
  stressChip: {
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 12, borderWidth: 1,
  },
  stressChipTxt: { fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },
  suggestionsRow: { maxHeight: 50, borderBottomWidth: 1, paddingVertical: 8 },
  suggestionChip: {
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 20, borderWidth: 1,
  },
  suggestionTxt: { fontSize: 12, fontWeight: '600' },
  chatList: { padding: 14, gap: 10, paddingBottom: 20 },
  aiRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, maxWidth: '85%' },
  aiAvatar: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, marginBottom: 4,
  },
  aiAvatarIcon: { fontSize: 14 },
  msgBubble: { maxWidth: '85%', padding: 12, borderRadius: 18 },
  userBubble: { alignSelf: 'flex-end', borderBottomRightRadius: 4 },
  aiBubble: { borderWidth: 1, borderBottomLeftRadius: 4 },
  userTxt: { fontWeight: '600', fontSize: 14, lineHeight: 20 },
  aiTxt: { fontSize: 14, lineHeight: 21 },
  timestamp: { fontSize: 10, marginTop: 4, fontWeight: '500' },
  actionTagBtn: {
    marginTop: 8, paddingVertical: 7, paddingHorizontal: 12,
    borderRadius: 10, alignSelf: 'flex-start', borderWidth: 1,
  },
  actionTagTxt: { fontWeight: '700', fontSize: 12 },
  typingDot: { width: 8, height: 8, borderRadius: 4 },
  inputBar: {
    flexDirection: 'row', padding: 12,
    borderTopWidth: 1, gap: 8, alignItems: 'center',
  },
  input: {
    flex: 1, borderRadius: 22, paddingHorizontal: 16,
    paddingVertical: 10, fontSize: 14,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnTxt: { fontSize: 20, fontWeight: '800' },
});
