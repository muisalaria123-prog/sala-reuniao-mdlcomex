import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, query, onSnapshot, addDoc, where, getDocs } from 'firebase/firestore';
import { create } from 'zustand';

// Este aplicativo é um exemplo completo e funcional com duas telas:
// uma página inicial e uma página de agendamento.
// Ele utiliza o React para a interface do usuário e o Firestore para
// gerenciar os agendamentos de forma persistente e em tempo real.
// A interface é construída com Tailwind CSS para um design moderno e responsivo.

// DECLARAÇÃO DO appId FORA DOS COMPONENTES, AGORA ACEDENDO O OBJETO GLOBAL 'window'
// Aceder 'window.__app_id' explicitamente ajuda a resolver o erro 'no-undef' do linter.
const appId = typeof window.__app_id !== 'undefined' ? window.__app_id : 'default-app-id';

// ZUSTAND: Gerenciamento de estado global.
// Usamos Zustand para gerenciar o estado da página (home/agendamento)
// e os dados do usuário, facilitando o acesso em todos os componentes.
const useStore = create((set) => ({
  currentPage: 'home',
  userId: null,
  setCurrentPage: (page) => set({ currentPage: page }),
  setUserId: (id) => set({ userId: id }),
}));

// FUNÇÃO PARA GERAR OS HORÁRIOS
// Esta função cria uma lista de horários de 30 em 30 minutos, de 08:00 a 18:00.
const generateTimeSlots = () => {
  const slots = [];
  for (let h = 8; h <= 18; h++) {
    for (let m = 0; m < 60; m += 30) {
      if (h === 18 && m > 0) continue;
      const hour = String(h).padStart(2, '0');
      const minute = String(m).padStart(2, '0');
      slots.push(`${hour}:${minute}`);
    }
  }
  return slots;
};

// COMPONENTE DA PÁGINA INICIAL
// A página de entrada com o botão "agende aqui".
const HomePage = ({ onNavigate }) => {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 bg-cover bg-center"
      style={{ backgroundImage: "url('https://placehold.co/1920x1080/0d133b/a9c1e1?text=MDL+COMEX')" }}
    >
      {/* Cabeçalho */}
      <div className="absolute top-0 left-0 w-full p-6 text-center bg-[#004aad] shadow-lg">
        <h1 className="text-4xl font-bold text-[#ffffff] animate-fade-in" style={{ fontFamily: 'Bodoni MT' }}>
          Sala de Reunião MDL COMEX
        </h1>
      </div>

      {/* Botão de Agendamento */}
      <div className="flex-grow flex items-center justify-center">
        <button
          onClick={onNavigate}
          className="bg-gradient-to-r from-[#004aad] to-[#003387] text-[#ffc300] font-bold py-4 px-8 rounded-full shadow-2xl hover:scale-105 transition-all duration-300 transform text-xl"
          style={{ fontFamily: 'Bodoni MT' }}
        >
          agende aqui
        </button>
      </div>
    </div>
  );
};

// COMPONENTE DA PÁGINA DE AGENDAMENTO
// A página principal para gerenciar os agendamentos.
const BookingPage = ({ db, userId, appId }) => {
  const { setCurrentPage } = useStore();
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedRoom, setSelectedRoom] = useState('Sala de Reunião 2º andar');
  const [userName, setUserName] = useState('');
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [agenda, setAgenda] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const timeSlots = generateTimeSlots();

  // EFETOR PARA OUVIR ALTERAÇÕES NO FIRESTORE
  useEffect(() => {
    if (!db || !userId || !appId) return;
    const bookingsCollectionRef = collection(db, 'artifacts', appId, 'public', 'data', 'mdl_comex_bookings');
    const q = query(bookingsCollectionRef);

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const allBookings = [];
      querySnapshot.forEach((doc) => {
        allBookings.push({ id: doc.id, ...doc.data() });
      });
      setBookings(allBookings);
      setLoading(false);
    }, (error) => {
      console.error("Erro ao obter dados do Firestore:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [db, userId, appId]);

  // FUNÇÃO PARA SALVAR O AGENDAMENTO
  const handleSaveBooking = async (time) => {
    setErrorMessage('');
    setSuccessMessage('');
    setAgenda('');

    if (!userName.trim()) {
      setErrorMessage('Por favor, insira o seu nome para agendar.');
      return;
    }

    if (!selectedDate || !selectedRoom || !time) {
      setErrorMessage('Por favor, selecione uma data, sala e horário.');
      return;
    }

    try {
      const bookingsCollectionRef = collection(db, 'artifacts', appId, 'public', 'data', 'mdl_comex_bookings');

      const q = query(
        bookingsCollectionRef,
        where('date', '==', selectedDate),
        where('time', '==', time),
        where('room', '==', selectedRoom)
      );
      const querySnapshot = await getDocs(q);

      if (!querySnapshot.empty) {
        setErrorMessage('Este horário já está reservado. Por favor, escolha outro.');
        return;
      }

      await addDoc(bookingsCollectionRef, {
        userName: userName,
        date: selectedDate,
        time: time,
        room: selectedRoom,
        createdAt: new Date().toISOString()
      });

      setSuccessMessage('Agendamento salvo com sucesso!');
      setUserName('');
    } catch (e) {
      console.error("Erro ao adicionar documento: ", e);
      setErrorMessage('Ocorreu um erro ao salvar o agendamento. Tente novamente.');
    }
  };

  // FUNÇÃO GEMINI API - GERAR AGENDA DE REUNIÃO
  const handleGenerateAgenda = async () => {
    if (!userName.trim() || !selectedDate || !selectedRoom) {
      setErrorMessage('Por favor, preencha o seu nome, data e sala para gerar a agenda.');
      return;
    }

    setIsGenerating(true);
    setAgenda('');

    const prompt = `Gere uma agenda profissional e amigável para uma reunião. 
    A reunião será na "${selectedRoom}" no dia ${selectedDate}. 
    O organizador é ${userName}. Inclua 3 a 5 pontos-chave para a agenda da reunião.
    Não adicione um título à agenda. Apenas os pontos.`;

    let chatHistory = [];
    chatHistory.push({ role: "user", parts: [{ text: prompt }] });
    const payload = { contents: chatHistory };
    const apiKey = "";
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

    let backoff = 1000;
    let response;
    let result;

    for (let i = 0; i < 3; i++) {
        try {
            response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (response.status === 429) {
                await new Promise(resolve => setTimeout(resolve, backoff));
                backoff *= 2;
                continue;
            }
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            result = await response.json();
            break;
        } catch (e) {
            console.error("Erro ao chamar o Gemini API:", e);
            setErrorMessage('Erro ao gerar a agenda. Tente novamente.');
            setIsGenerating(false);
            return;
        }
    }
    
    if (result && result.candidates && result.candidates.length > 0 &&
        result.candidates[0].content && result.candidates[0].content.parts &&
        result.candidates[0].content.parts.length > 0) {
      const text = result.candidates[0].content.parts[0].text;
      setAgenda(text);
    } else {
      setErrorMessage('Não foi possível gerar a agenda. A resposta do modelo está vazia.');
    }
    setIsGenerating(false);
  };

  // FUNÇÃO PARA VERIFICAR A DISPONIBILIDADE
  const isSlotBooked = (date, time, room) => {
    return bookings.some(
      (booking) =>
        booking.date === date &&
        booking.time === time &&
        booking.room === room
    );
  };

  // ESTILIZAÇÃO DO BOTÃO DE HORÁRIO
  const getTimeSlotClass = (time) => {
    const isBooked = isSlotBooked(selectedDate, time, selectedRoom);
    return `px-4 py-2 rounded-lg text-white transition-colors duration-200 ease-in-out
      ${isBooked
        ? 'bg-red-500 cursor-not-allowed'
        : 'bg-green-600 hover:bg-green-700 cursor-pointer'
      }`;
  };
  
  return (
    <div className="min-h-screen bg-[#f3f4f6] font-sans text-gray-800 p-6 sm:p-8">
      {/* Botão de Voltar */}
      <button onClick={() => setCurrentPage('home')} className="absolute top-4 left-4 text-[#004aad] hover:text-[#003387] text-3xl font-bold p-2 transition-colors duration-200">
        &larr;
      </button>

      {/* Cabeçalho da Página de Agendamento */}
      <div className="w-full p-6 text-center bg-[#004aad] shadow-lg mb-8 rounded-xl">
        <h1 className="text-3xl sm:text-4xl font-bold text-[#ffffff]" style={{ fontFamily: 'Bodoni MT' }}>
          Sala de Reunião MDL COMEX
        </h1>
      </div>

      <div className="max-w-4xl mx-auto bg-white p-6 sm:p-8 rounded-2xl shadow-xl space-y-6">
        <div className="flex flex-col sm:flex-row items-center justify-between space-y-4 sm:space-y-0 sm:space-x-4">
          {/* Seleção de Data */}
          <div className="w-full sm:w-1/3">
            <label htmlFor="date" className="block text-sm font-medium text-gray-700">Data:</label>
            <input
              id="date"
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring focus:ring-indigo-200 focus:ring-opacity-50 p-2"
            />
          </div>

          {/* Seleção de Sala */}
          <div className="w-full sm:w-1/3">
            <label htmlFor="room" className="block text-sm font-medium text-gray-700">Sala:</label>
            <select
              id="room"
              value={selectedRoom}
              onChange={(e) => setSelectedRoom(e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring focus:ring-indigo-200 focus:ring-opacity-50 p-2"
            >
              <option>Sala de Reunião 2º andar</option>
              <option>Sala de Reunião 8º andar</option>
            </select>
          </div>

          {/* Nome da Pessoa */}
          <div className="w-full sm:w-1/3">
            <label htmlFor="name" className="block text-sm font-medium text-gray-700">O seu Nome:</label>
            <input
              id="name"
              type="text"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              placeholder="Digite o seu nome"
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring focus:ring-indigo-200 focus:ring-opacity-50 p-2"
            />
          </div>
        </div>

        {/* Mensagens de feedback */}
        {errorMessage && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg relative transition-all duration-300 ease-in-out mt-4" role="alert">
            <span className="block sm:inline">{errorMessage}</span>
          </div>
        )}
        {successMessage && (
          <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded-lg relative transition-all duration-300 ease-in-out mt-4" role="alert">
            <span className="block sm:inline">{successMessage}</span>
          </div>
        )}

        {/* Grade de Horários */}
        <div>
          <h3 className="text-xl font-semibold mb-4 text-[#004aad]">Horários de Agendamento</h3>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
            {timeSlots.map((time) => (
              <button
                key={time}
                onClick={() => handleSaveBooking(time)}
                className={getTimeSlotClass(time)}
                disabled={isSlotBooked(selectedDate, time, selectedRoom)}
              >
                {time}
              </button>
            ))}
          </div>
        </div>

        {/* NOVA SEÇÃO: GERADOR DE AGENDA COM GEMINI API */}
        <div className="mt-6 p-6 bg-blue-50 rounded-xl shadow-inner border-l-4 border-blue-400">
          <h4 className="text-lg font-semibold text-[#004aad] mb-2">Gerar uma agenda de reunião ✨</h4>
          <button
            onClick={handleGenerateAgenda}
            disabled={isGenerating}
            className="flex items-center justify-center bg-gradient-to-r from-[#004aad] to-[#003387] text-[#ffc300] font-bold py-2 px-4 rounded-lg hover:scale-105 transition-all duration-300 disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {isGenerating ? (
              <>
                <svg className="animate-spin h-5 w-5 mr-3 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Gerando...
              </>
            ) : (
              'Gerar Agenda ✨'
            )}
          </button>
          {agenda && (
            <div className="mt-4 p-4 bg-white rounded-lg border border-gray-200 shadow-md">
              <h5 className="font-semibold text-gray-800">Agenda da Reunião:</h5>
              <p className="mt-2 text-gray-600 whitespace-pre-wrap">{agenda}</p>
            </div>
          )}
        </div>
      </div>

      {/* Seção de Agendamentos Existentes */}
      <div className="mt-8 max-w-4xl mx-auto">
        <div className="p-6 sm:p-8 bg-white rounded-2xl shadow-xl">
          <h3 className="text-2xl font-bold mb-4 text-[#004aad]">Agendamentos Existentes</h3>
          {loading ? (
            <div className="flex justify-center items-center h-20">
              <div className="w-10 h-10 border-4 border-[#004aad] border-t-transparent rounded-full animate-spin"></div>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg shadow-inner">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-[#f0f4f8]">
                  <tr>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Utilizador
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Data
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Horário
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Sala
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {bookings.map((booking) => (
                    <tr key={booking.id} className="hover:bg-gray-50 transition-colors duration-150">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {booking.userName}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {booking.date}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {booking.time}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {booking.room}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {/* ID DO UTILIZADOR - MANDATÓRIO PARA APLICATIVOS COLABORATIVOS */}
          <div className="mt-4 text-xs text-gray-500">
              <span className="font-bold">O seu ID de utilizador:</span> {userId}
          </div>
        </div>
      </div>
    </div>
  );
};

// COMPONENTE PRINCIPAL DO APLICATIVO
// Gerencia a inicialização do Firebase e o roteamento entre as páginas.
export default function App() {
  const { currentPage, setCurrentPage, setUserId } = useStore();
  const [db, setDb] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  // EFETOR PARA INICIALIZAR O FIREBASE E AUTENTICAÇÃO
  useEffect(() => {
    // Inicialização e autenticação do Firebase.
    const initFirebase = async () => {
      try {
        // Credenciais do Firebase fornecidas pelo utilizador.
        const firebaseConfig = {
          apiKey: "AIzaSyBqmVLaJu4wwqOqJOIZHBfRLlbQB6AHSUE",
          authDomain: "agendamento-de-salas-7b53a.firebaseapp.com",
          projectId: "agendamento-de-salas-7b53a",
          storageBucket: "agendamento-de-salas-7b53a.firebasestorage.app",
          messagingSenderId: "624176787172",
          appId: "1:624176787172:web:5e3a1558f58606617a46f1",
          measurementId: "G-560Q10SCES"
        };
        
        const app = initializeApp(firebaseConfig);
        const firestoreDb = getFirestore(app);
        const firebaseAuth = getAuth(app);
        setDb(firestoreDb);

        // Usamos a autenticação anónima, pois não há necessidade de um token personalizado.
        await signInAnonymously(firebaseAuth);
        
        onAuthStateChanged(firebaseAuth, (user) => {
          if (user) {
            setUserId(user.uid);
          } else {
            setUserId(null);
          }
          setIsAuthReady(true);
        });

      } catch (e) {
        console.error("Erro ao inicializar Firebase:", e);
        setIsAuthReady(false);
      }
    };
    initFirebase();
  }, [setUserId]);

  const handleNavigateToBooking = () => {
    setCurrentPage('booking');
  };

  if (!isAuthReady || !db) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100">
        <div className="w-16 h-16 border-4 border-[#004aad] border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <>
      {currentPage === 'home' && <HomePage onNavigate={handleNavigateToBooking} />}
      {currentPage === 'booking' && <BookingPage db={db} userId={useStore.getState().userId} appId={appId} />}
    </>
  );
}
