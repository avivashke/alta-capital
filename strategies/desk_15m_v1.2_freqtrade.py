# ============================================================
# Alta Capital — auto-generated strategy artifact
# Desk: תוך־יומי · 15 דקות · ETHUSDT · 15m
# Version: v1.2 · Strategy family: rsi_reversion
# Backtest: return 3.61% · PF 1.98 · DD 1.77% · trades 14
# OOS: 1.57% · Sharpe 11.49
# Params: {"period":8,"oversold":25,"overbought":78,"atrStop":1.1,"rr":1.8}
# Target platform: Freqtrade
# Generated: 2026-11-20T01:20:19.445Z
# Research artifact only — no warranty, no live order routing.
# ============================================================
# Drop this file in freqtrade/user_data/strategies/ and run:
#   freqtrade backtesting --strategy Altadesk_15m --config user_data/config.json
#   freqtrade trade --strategy Altadesk_15m --config user_data/config.json --dry-run

from freqtrade.strategy import IStrategy
from pandas import DataFrame
import talib.abstract as ta


class Altadesk_15m(IStrategy):
    INTERFACE_VERSION = 3

    timeframe = '15m'
    can_short = True
    startup_candle_count = 210

    stoploss = -0.013
    minimal_roi = {"0": 1.62, "240": 0.01, "720": 0}

    trailing_stop = False
    process_only_new_candles = True
    use_exit_signal = True
    exit_profit_only = False

    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe['rsi'] = ta.RSI(dataframe, timeperiod=8)
        dataframe['atr'] = ta.ATR(dataframe, timeperiod=14)
        return dataframe

    def populate_entry_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe.loc[
            (
        & (dataframe['rsi'] <= 25)
        & (dataframe['rsi'].shift(1) > 25)
                & (dataframe['volume'] > 0)
            ),
            'enter_long',
        ] = 1
        dataframe.loc[
            (
        & (dataframe['rsi'] >= 78)
        & (dataframe['rsi'].shift(1) < 78)
                & (dataframe['volume'] > 0)
            ),
            'enter_short',
        ] = 1
        return dataframe

    def populate_exit_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        # Risk-managed exits: ATR stop + fixed R multiple handled by the engine.
        dataframe.loc[
            (
        & (dataframe['rsi'] <= 25)
        & (dataframe['rsi'].shift(1) > 25)
            ),
            'exit_short',
        ] = 1
        dataframe.loc[
            (
        & (dataframe['rsi'] >= 78)
        & (dataframe['rsi'].shift(1) < 78)
            ),
            'exit_long',
        ] = 1
        return dataframe
