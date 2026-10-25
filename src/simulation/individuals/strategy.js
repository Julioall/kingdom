export function recordPersonalMemory(person, day) {
    if (!person.personalMemory) person.personalMemory = [];
    const state = String(person.state || '').slice(0, 50);
    const lesson = String(person.lastLesson || '').slice(0, 135);
    const previous = person.personalMemory[person.personalMemory.length - 1];
    if (previous && previous.state === state && previous.lesson === lesson && day - previous.day < 4) return;
    person.personalMemory.push({ day, state, lesson });
    if (person.personalMemory.length > 4) person.personalMemory.shift();
  }
