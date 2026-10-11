export const generateRandomLastActivity = () => {
  const now = new Date();

  const randomHours = Math.floor(Math.random() * 240);

  return new Date(now.getTime() - randomHours * 60 * 60 * 1000);
};
