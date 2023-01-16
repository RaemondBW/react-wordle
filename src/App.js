import './App.css';
import React, { useState, useEffect} from 'react';
import Cookies from 'js-cookie';

const wordLength = 5;
const numberOfGuesses = 6;

const WordleBoard = ({word, previousGuesses, guessIndex, invalidGuess}) => {

  const getLetterStatus = (guess, index, activeGuess) => {
    if (activeGuess) {
      return ''
    } else if (index >= guess.length) {
      return '';
    } else if (guess[index] === word[index]) {
      return 'green'
    } else if (word.includes(guess[index]) && word.split(guess[index]).length > 1) {
      return 'yellow'
    } else {
      return 'gray'
    }
    return '';
  }

  return (
    <div className="gameboard">
      {previousGuesses.map((guess, word_index) => (
        <div className={`gameboard-row ${(invalidGuess && guessIndex === word_index) ? "shake" : ""}`}>
          {[...Array(wordLength)].map((e, letter_index) => (
            <div className={`letter ${getLetterStatus(guess, letter_index, guessIndex === word_index)}`}>
              <b>{guess.length > letter_index ? guess[letter_index].toUpperCase() : ''}</b>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

const Keyboard = ({ handleKeyPress, letterColors}) => {
  const keys = [
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
    ['ENTER','z', 'x', 'c', 'v', 'b', 'n', 'm','⌫'],
  ];

  const handleClick = (letter) => {
    handleKeyPress(letter);
  };

  return (
    <div className="keyboard">
      {keys.map((row) => (
        <div className="keyboard-row" key={row}>
          {row.map((letter) => (
            <button
              key={letter}
              className={`key ${letterColors[letter] ?? ''} ${letter === 'ENTER'?'enter':''} ${letter === '⌫' ? 'backspace' : ''}`}
              onClick={() => handleClick(letter)}
            >
              <b>{letter.toUpperCase()}</b>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
};

const WordleGame = () => {
  const [word, setWord] = useState('');
  const [previousGuesses, setPreviousGuesses] = useState(Array(numberOfGuesses).fill(''));
  const [guessIndex, setGuessIndex] = useState(0);
  const [keyboardLetterColors, setKeyboardLetterColors] = useState({
    a: "",
    b: "",
    c: "",
    d: "",
    e: "",
    f: "",
    g: "",
    h: "",
    i: "",
    j: "",
    k: "",
    l: "",
    m: "",
    n: "",
    o: "",
    p: "",
    q: "",
    r: "",
    s: "",
    t: "",
    u: "",
    v: "",
    w: "",
    x: "",
    y: "",
    z: ""
  });
  const [scrabbleDictionary, setScrabbleDictionary] = useState(new Set());
  const [invalidGuess, setInvalidGuess] = useState(false);
  const [requestedWord, setRequestedWord] = useState('');
  const [invalidRequestedWord, setInvalidRequestedWord] = useState(false);

  const updateLetterValues = (guessedWord, answer) => {
    const newKeyboardLetterColors = {...keyboardLetterColors};
    guessedWord.split('').forEach((letter, i) => {
      if (answer[i] === guessedWord[i]) {
        newKeyboardLetterColors[letter] = "green";
      } else if (answer.includes(letter) && newKeyboardLetterColors[letter] !== "green") {
        newKeyboardLetterColors[letter] = "yellow"; 
      } else if (newKeyboardLetterColors[letter] === '') {
        newKeyboardLetterColors[letter] = "gray";
      }
    })
    setKeyboardLetterColors(newKeyboardLetterColors);
  }

  const handleKeyPress = (letter) => {
    const newGuesses = [...previousGuesses];
    setInvalidGuess(false);
    if (letter === '⌫') {
      if (newGuesses[guessIndex].length > 0) {
        newGuesses[guessIndex] = newGuesses[guessIndex].slice(0, -1); 
      }
    } else if (letter === 'ENTER') {
      if (guessIndex < numberOfGuesses && newGuesses[guessIndex].length === wordLength && scrabbleDictionary.has(newGuesses[guessIndex].toUpperCase())) {
        updateLetterValues(newGuesses[guessIndex], word);
        setGuessIndex(guessIndex + 1);
        Cookies.set(word, JSON.stringify(newGuesses));
      } else {
        setInvalidGuess(true);
      }
    } else if (newGuesses[guessIndex].length < wordLength) {
      newGuesses[guessIndex] = newGuesses[guessIndex].concat(letter);
    }
    
    setPreviousGuesses(newGuesses);
  };

  const handleWordCreation = (requestedWord) => {
    if (scrabbleDictionary.has(requestedWord.toUpperCase())) {
      window.location.href = window.location.href + `?${btoa("word=" + requestedWord.toLowerCase())}`;
    } else {
      setInvalidRequestedWord(true);
    }
  }

  useEffect(() => {
    document.title = 'Wordle Pick';

    const urlParams = new URLSearchParams(atob(window.location.search.substring(1)));
    const args = {};
    for (let param of urlParams.entries()) {
      args[param[0]] = param[1];
    }
    if ('word' in args) {
      setWord(args['word']);
      if (Cookies.get(args['word'])) {
        setPreviousGuesses(JSON.parse(Cookies.get(args['word'])));
        setGuessIndex(previousGuesses.length);
      }
    }

    fetch(window.location.origin + window.location.pathname + 'dictionary.json')
    .then(response => response.json())
    .then(data => {
      setScrabbleDictionary(new Set(data.dictionary[wordLength-1]));
    });

    function handleKeyDown(e) {
      if (word.length === 0) {
        return;
      }
      if (e.key === "Backspace") {
        handleKeyPress("⌫")
      } else if (e.key === "Enter") {
        handleKeyPress("ENTER")
      } else if (e.key in keyboardLetterColors) {
        handleKeyPress(e.key);
      }
    }

    document.addEventListener('keydown', handleKeyDown);

    // Don't forget to clean up
    return function cleanup() {
      document.removeEventListener('keydown', handleKeyDown);
    }
  }, []);

  return (
    <div className="App">
      { word.length !== 0 &&
        <div>
          <WordleBoard word={word} previousGuesses={previousGuesses} guessIndex={guessIndex} invalidGuess={invalidGuess}/>
          <Keyboard handleKeyPress={handleKeyPress} letterColors={keyboardLetterColors}/>
          <div className="button">
            <button className="button-text" onClick={() => {
              window.location.href = window.location.origin + window.location.pathname;
            }}><b>Make a new game!</b></button>
          </div>
        </div>
      }

      { word.length === 0 &&
        <div>
          <div className="wordPickerText">
            <b>Pick a 5 letter word for people to guess</b>
          </div> 
          <input className={`wordInput ${invalidRequestedWord? 'shake': ''}`} onChange={evt => {
            setRequestedWord(evt.target.value);
            setInvalidRequestedWord(false);
          }}>
          </input>
          <div className="button">
            <button className="button-text" onClick={() => handleWordCreation(requestedWord)}><b>Make Game!</b></button>
          </div>
        </div> 
      }
    </div>
  )
}

function App() {
  return (
    <WordleGame />
  );
}

export default App;
