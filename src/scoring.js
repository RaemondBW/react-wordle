// Scores a guess like the real game: greens first, then yellows only while the
// answer still has unmatched copies of that letter, so a repeated letter in the
// guess isn't marked yellow more times than it appears in the answer.
export const scoreGuess = (guess, answer) => {
  const result = Array(guess.length).fill('gray');
  const remaining = {};
  for (let i = 0; i < answer.length; i++) {
    if (guess[i] === answer[i]) {
      result[i] = 'green';
    } else {
      remaining[answer[i]] = (remaining[answer[i]] || 0) + 1;
    }
  }
  for (let i = 0; i < guess.length; i++) {
    if (result[i] !== 'green' && remaining[guess[i]] > 0) {
      result[i] = 'yellow';
      remaining[guess[i]]--;
    }
  }
  return result;
}
