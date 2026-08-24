import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { icons } from "lucide-react";

const CURATED_EMOJIS = [
  // Faces & People
  "😀", "😎", "🤓", "🧑‍💻", "👾", "🤖", "👻", "💀",
  // Nature
  "🌟", "⭐", "🔥", "💧", "🌈", "🌊", "🍀", "🌸",
  // Objects
  "🚀", "💎", "🎯", "🎨", "🎵", "📦", "🔮", "💡",
  "⚡", "🔔", "🏆", "🎮", "🎲", "📌", "🔑", "🛡️",
  // Symbols
  "❤️", "💜", "💙", "💚", "💛", "🧡", "🩷", "🖤",
  "✨", "💫", "🌀", "♾️", "⚙️", "🔧", "📐", "🧪",
  // Animals
  "🐱", "🐶", "🦊", "🐻", "🐼", "🦁", "🐸", "🦋",
  // Food
  "☕", "🍕", "🍔", "🌮", "🍩", "🧁", "🍎", "🍑",
  // Travel
  "🏠", "🏔️", "🌍", "🏝️", "🌙", "☀️", "⛈️", "🌤️",
  // Misc
  "📚", "💻", "🖥️", "📱", "🎪", "🏗️", "🧲", "🔬",
  "🎭", "🎬", "📡", "🧬", "🔒", "🏴‍☠️", "🚩", "🏁",
];

// Popular lucide icon names — must match PascalCase keys in the `icons` map
const POPULAR_ICONS = [
  "Layers", "Rocket", "Code", "Terminal", "Globe", "Heart", "Star", "Zap",
  "Shield", "Target", "Compass", "Flame", "Gem", "Crown", "Coffee", "Music",
  "Camera", "Book", "Briefcase", "Cpu", "Database", "Feather", "Gift", "Home",
  "Key", "Lamp", "Map", "Palette", "PenTool", "Puzzle", "Scissors", "Settings",
  "Sparkles", "Sun", "Umbrella", "Wand", "Wrench", "Box", "Cloud", "Flag",
];

interface IconPickerProps {
  value: string;
  iconType: "emoji" | "lucide";
  onChange: (icon: string, type: "emoji" | "lucide") => void;
}

export function IconPicker({ value, iconType, onChange }: IconPickerProps) {
  const { t } = useTranslation("common");
  const [search, setSearch] = useState("");
  const tab = iconType === "emoji" ? "emoji" : "icons";

  const filteredIcons = useMemo(() => {
    const allNames = Object.keys(icons);
    if (!search) return POPULAR_ICONS.filter((n) => allNames.includes(n));
    const q = search.toLowerCase();
    return allNames.filter((n) => n.toLowerCase().includes(q)).slice(0, 80);
  }, [search]);

  return (
    <Tabs defaultValue={tab} className="w-full">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="emoji">{t("iconPicker.emoji")}</TabsTrigger>
        <TabsTrigger value="icons">{t("iconPicker.icons")}</TabsTrigger>
      </TabsList>

      <TabsContent value="emoji">
        <ScrollArea className="h-48">
          <div className="grid grid-cols-8 gap-1 p-1">
            {CURATED_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => onChange(emoji, "emoji")}
                className={`flex h-8 w-8 items-center justify-center rounded text-lg hover:bg-accent ${
                  value === emoji && iconType === "emoji" ? "bg-accent ring-1 ring-ring" : ""
                }`}
              >
                {emoji}
              </button>
            ))}
          </div>
        </ScrollArea>
      </TabsContent>

      <TabsContent value="icons" className="space-y-2">
        <Input
          placeholder={t("iconPicker.search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 text-sm"
        />
        <ScrollArea className="h-48">
          <div className="grid grid-cols-8 gap-1 p-1">
            {filteredIcons.map((name) => {
              const Icon = icons[name as keyof typeof icons];
              if (!Icon) return null;
              return (
                <button
                  key={name}
                  onClick={() => onChange(name, "lucide")}
                  title={name}
                  className={`flex h-8 w-8 items-center justify-center rounded hover:bg-accent ${
                    iconType === "lucide" && value.toLowerCase() === name.toLowerCase() ? "bg-accent ring-1 ring-ring" : ""
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </TabsContent>
    </Tabs>
  );
}
